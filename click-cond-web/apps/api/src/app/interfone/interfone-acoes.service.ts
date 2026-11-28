import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FacialService } from '../facial/facial.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { StorageService } from '../common/storage/storage.service';
import { intervaloHojeBrasilia } from '../common/hora-brasilia.util';
import { rotuloAptoBloco } from '../visitantes/rotulo-apto-bloco.util';
import { InterfoneService, unidadeDaChamada } from './interfone.service';
import { InterfonePushService } from './interfone-push.service';
import { VozControleClient } from './voz-controle.client';
import { DadosEntrada, PapelVoz, assinarTokenVoz, credencialTurn, montarDadosEntrada } from './token-voz';

export { RESERVA_ATENDER_MS } from './interfone.service';
/** Abrir só logo depois de atendida (toque + conversa máxima + folga): chamada órfã não abre. */
export const ABRIR_JANELA_MS = 210_000;
export const ABRIR_MAX_POR_CHAMADA = 3;
export const ABRIR_INTERVALO_MS = 5_000;
/** Trava contra toque duplo em "ligar" (por usuário/porteiro). */
const LIGAR_TRAVA_MS = 5_000;
const DIA_MS = 86_400_000;
const HISTORICO_DIAS = 30;
const HISTORICO_MAX = 50;
const HOJE_MAX = 200;
/** Chamada de origem do app (ligar para a portaria) considerada ativa neste prazo. */
const ORIGEM_ATIVA_MS = 10 * 60_000;

export interface QuemMorador {
  papel: 'morador';
  /** Users.id */
  uid: number;
  nome: string;
}
export interface QuemPortaria {
  papel: 'portaria';
  /** Funcionarios_Portaria.id */
  uid: number;
  nome: string;
  idCondominio: number;
}
export type Quem = QuemMorador | QuemPortaria;

export interface ItemHistorico {
  id: number;
  tipo: string;
  inicio: Date;
  resultado: string | null;
  atendida_por_nome: string | null;
  /** URL do bucket; o ArquivosPrivadosInterceptor assina na saída HTTP. */
  foto_url: string | null;
  porta_aberta: boolean;
}

function conflito(motivo: string, message: string): ConflictException {
  return new ConflictException({ statusCode: 409, motivo, message });
}

/** 403 do módulo desligado: o console e o app tratam como "interfone não existe aqui". */
function moduloDesligado(): ForbiddenException {
  return new ForbiddenException({
    statusCode: 403,
    motivo: 'modulo_desligado',
    message: 'O interfone não está ligado neste condomínio.',
  });
}

/**
 * Ações do app e do console no interfone: atender, recusar, abrir, ligar,
 * histórico e preferências. O núcleo (InterfoneService) cuida do estado que
 * vem do serviço de voz; aqui ficam as regras de quem pode o quê.
 *
 * Regra de ouro (Global Constraints): ninguém abre fora da chamada — abrir
 * exige chamada `atendida`, quem pede = quem atendeu, e abre o facial DA
 * chamada (o pedido não escolhe portão).
 */
@Injectable()
export class InterfoneAcoesService {
  private readonly logger = new Logger(InterfoneAcoesService.name);
  /** Público para os testes; em produção é Date.now. */
  agora: () => number = () => Date.now();
  /** Aberturas por chamada (memória desta réplica): limite e intervalo. */
  private readonly aberturas = new Map<number, { n: number; ultima: number }>();
  /** "Ligar" em andamento por quem liga (memória desta réplica). */
  private readonly ligando = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly nucleo: InterfoneService,
    private readonly push: InterfonePushService,
    private readonly voz: VozControleClient,
    @Optional() private readonly facial?: FacialService,
    @Optional() private readonly auditoria?: AuditoriaService,
    @Optional() private readonly storage?: StorageService,
  ) {}

  // ─────────────────────────────────────────── atender / recusar / abrir

  async atender(id: number, quem: Quem): Promise<DadosEntrada> {
    if (quem.papel === 'portaria') await this.assertModulo(quem.idCondominio);
    const c = await this.nucleo.carregar(id);
    if (!c) throw new NotFoundException('Chamada não encontrada.');
    await this.assertPodeVer(c, quem);
    if (quem.papel === 'morador') await this.assertModulo(c.id_condominio);
    if (c.estado === 'encerrada') throw conflito('encerrada', 'A chamada já terminou.');
    if (c.estado === 'atendida') throw conflito('ja_atendida', 'A chamada já foi atendida.');

    const pode =
      quem.papel === 'morador'
        ? c.estado === 'chamando' && (c.tipo === 'facial_unidade' || c.tipo === 'portaria_unidade')
        : c.estado === 'portaria' && (c.tipo === 'facial_unidade' || c.tipo === 'unidade_portaria');
    if (!pode) throw conflito('ja_atendida', 'A chamada não está disponível para você.');

    const segredos = this.segredos();
    const agora = this.agora();
    // Reserva vale só no estado atual: se a chamada for para a portaria, o
    // pedido do morador não segura o porteiro.
    if (!this.nucleo.reservar(c.id, `${quem.papel}:${quem.uid}`, c.estado, agora)) {
      throw conflito('ja_atendida', 'Já atendida em outro aparelho.');
    }

    return this.dadosEntrada(c.id, quem.papel, quem.uid, quem.nome, segredos, agora);
  }

  async recusar(id: number, idUser: number): Promise<{ ok: true }> {
    const c = await this.nucleo.carregar(id);
    if (!c) throw new NotFoundException('Chamada não encontrada.');
    await this.assertVinculo(idUser, c.id_apartamento);
    // Quem reservou e desistiu (ex.: "Conectando…" e recusou) libera a chamada.
    this.nucleo.liberarReserva(c.id, `morador:${idUser}`);
    if (c.estado !== 'chamando' || (c.tipo !== 'facial_unidade' && c.tipo !== 'portaria_unidade')) return { ok: true };

    if (!(await this.acrescentarRecusa(c.id, idUser))) return { ok: true };
    // Todos em que o toque SAIU recusaram? (regra no núcleo, também chamada
    // depois de o toque gravar quem tocou)
    await this.nucleo.avaliarRecusas(c.id);
    return { ok: true };
  }

  /**
   * Acrescenta a recusa sem perder outra que chegue junto: grava só se
   * `recusas` ainda é o que foi lido (tenta de novo se mudou).
   */
  private async acrescentarRecusa(id: number, idUser: number): Promise<Set<number> | null> {
    for (let i = 0; i < 8; i++) {
      const linha = await this.prisma.interfone_Chamadas.findUnique({ where: { id }, select: { recusas: true } });
      if (!linha) return null;
      const lista = new Set<number>(this.lerRecusas(linha.recusas));
      if (lista.has(idUser)) return lista;
      lista.add(idUser);
      const r = await this.prisma.interfone_Chamadas.updateMany({
        where: { id, recusas: linha.recusas ?? null },
        data: { recusas: JSON.stringify([...lista]) },
      });
      if (r.count === 1) return lista;
    }
    this.logger.warn(`Interfone: recusa do usuário ${idUser} na chamada ${id} não gravou (concorrência).`);
    return null;
  }

  async abrir(id: number, quem: Quem): Promise<{ ok: boolean; motivo?: string }> {
    // O módulo é reconferido a cada abertura, antes de acionar o portão: desligado
    // (ou condomínio desativado) no meio da conversa não abre, nem dentro dos 210 s.
    // A recusa vem antes do contador de aberturas e não gasta nenhuma das 3.
    if (quem.papel === 'portaria') await this.assertModulo(quem.idCondominio);
    const c = await this.nucleo.carregar(id);
    if (!c) return { ok: false, motivo: 'chamada_nao_encontrada' };
    await this.assertPodeVer(c, quem);
    if (quem.papel === 'morador') await this.assertModulo(c.id_condominio);
    if (c.estado !== 'atendida') return { ok: false, motivo: 'chamada_nao_atendida' };
    if (c.atendida_por_tipo !== quem.papel || c.atendida_por_id !== quem.uid) {
      return { ok: false, motivo: 'atendida_por_outro' };
    }
    if (c.tipo !== 'facial_unidade' || !c.id_facial || !c.facial) return { ok: false, motivo: 'sem_portao' };
    if (!this.facial) return { ok: false, motivo: 'indisponivel' };
    const agoraMs = this.agora();
    // Chamada que ficou "atendida" porque o serviço perdeu o encerrada não abre.
    if (!c.atendida_em || agoraMs - c.atendida_em.getTime() > ABRIR_JANELA_MS) return { ok: false, motivo: 'chamada_expirada' };
    const ab = this.aberturas.get(c.id);
    if (ab && (ab.n >= ABRIR_MAX_POR_CHAMADA || agoraMs - ab.ultima < ABRIR_INTERVALO_MS)) return { ok: false, motivo: 'aguarde' };
    this.aberturas.set(c.id, { n: (ab?.n ?? 0) + 1, ultima: agoraMs });
    if (this.aberturas.size > 1000) {
      for (const [k, v] of this.aberturas) if (agoraMs - v.ultima > ABRIR_JANELA_MS) this.aberturas.delete(k);
    }

    const unidade = unidadeDaChamada(c);
    const ctx = { origem: 'interfone' as const, tipoPessoa: 'visitante', nomePessoa: `Interfone ${unidade}`.trim() };
    let como: 'agente' | 'dtmf' | null = null;
    const r = await this.facial.abrirDispositivoInterno(c.id_facial, ctx);
    if (r.ok) como = 'agente';
    else if (c.facial.interfone_dtmf && (await this.voz.dtmf(c.id, c.facial.interfone_dtmf))) {
      como = 'dtmf';
      // O histórico de acessos já tem a falha do agente; registra a abertura que deu certo.
      await this.facial.registrarAberturaExterna(c.id_facial, { ...ctx, nota: 'DTMF' });
    }
    if (!como) return { ok: false, motivo: 'falha_ao_abrir' };

    const agora = new Date(this.agora());
    await this.prisma.interfone_Chamadas.update({
      where: { id: c.id },
      data: { porta_aberta_em: agora, porta_aberta_por_nome: (quem.nome || '').slice(0, 120) || null, porta_aberta_como: como },
    });
    await this.auditoria?.registrar({
      id_condominio: c.id_condominio,
      usuario_nome: quem.nome || (quem.papel === 'morador' ? 'Morador' : 'Portaria'),
      autor_id: quem.uid,
      autor_tipo: quem.papel === 'morador' ? 'user' : 'funcionario_portaria',
      acao: 'INTERFONE_ABRIR',
      modulo: 'interfone',
      entidade_id: c.id,
      descricao: `Portão "${c.facial.nome}" aberto pelo interfone (${unidade || 'sem unidade'})`,
      detalhes: { como, papel: quem.papel, id_facial: c.id_facial },
    });
    return { ok: true };
  }

  /**
   * Console: o porteiro encerra a chamada do seu condomínio — só a que está na
   * portaria, a que ele atendeu ou a que ele originou (não derruba a conversa
   * do morador nem a chamada que ainda toca no apartamento).
   */
  async encerrarPortaria(id: number, porteiro: QuemPortaria): Promise<{ ok: boolean }> {
    await this.assertModulo(porteiro.idCondominio);
    const c = await this.nucleo.carregar(id);
    if (!c) throw new NotFoundException('Chamada não encontrada.');
    this.assertMesmoCondominio(c.id_condominio, porteiro);
    if (c.estado === 'encerrada') return { ok: true };
    const dele =
      c.estado === 'portaria' ||
      (c.atendida_por_tipo === 'portaria' && c.atendida_por_id === porteiro.uid) ||
      c.id_porteiro_origem === porteiro.uid;
    if (!dele) throw new ForbiddenException('Esta chamada não está com a portaria.');
    return { ok: await this.voz.encerrar(c.id) };
  }

  // ─────────────────────────────────────────── ligar

  /** App: o morador liga para a portaria do condomínio da unidade. */
  async ligarPortaria(quem: QuemMorador, idApartamento: number): Promise<DadosEntrada> {
    return this.comTrava(`morador:${quem.uid}`, () => this.ligarPortariaSemTrava(quem, idApartamento));
  }

  private async ligarPortariaSemTrava(quem: QuemMorador, idApartamento: number): Promise<DadosEntrada> {
    await this.assertVinculo(quem.uid, idApartamento);
    const apto = await this.aptoComModulo(idApartamento);
    if (!apto) throw moduloDesligado();
    const segredos = this.segredos();
    if (!(await this.nucleo.porteirosOnline(apto.id_condominio))) {
      throw conflito('portaria_indisponivel', 'Não há porteiro no console agora.');
    }
    const agora = this.agora();
    const ativa = await this.prisma.interfone_Chamadas.count({
      where: {
        tipo: 'unidade_portaria',
        id_user_origem: quem.uid,
        estado: { not: 'encerrada' },
        created_at: { gte: new Date(agora - ORIGEM_ATIVA_MS) },
      },
    });
    if (ativa > 0) throw conflito('em_andamento', 'Você já tem uma ligação para a portaria em andamento.');

    const c = await this.prisma.interfone_Chamadas.create({
      data: {
        id_condominio: apto.id_condominio,
        tipo: 'unidade_portaria',
        estado: 'portaria',
        id_apartamento: apto.id,
        id_user_origem: quem.uid,
        created_at: new Date(agora),
      },
    });
    this.nucleo.emitirParaPortaria(apto.id_condominio, {
      id: c.id,
      tipo: 'unidade_portaria',
      unidade: rotuloAptoBloco(apto.apto, apto.bloco),
      motivo: null,
      morador_nome: quem.nome || null,
      foto_url: null,
    });
    return this.dadosEntrada(c.id, 'origem', quem.uid, quem.nome, segredos, agora);
  }

  /** Console: o porteiro liga para uma unidade do seu condomínio. */
  async ligarUnidade(porteiro: QuemPortaria, idApartamento: number): Promise<DadosEntrada> {
    return this.comTrava(`portaria:${porteiro.uid}`, () => this.ligarUnidadeSemTrava(porteiro, idApartamento));
  }

  private async ligarUnidadeSemTrava(porteiro: QuemPortaria, idApartamento: number): Promise<DadosEntrada> {
    await this.assertModulo(porteiro.idCondominio);
    const existe = await this.prisma.apartamentos.findFirst({ where: { id: idApartamento }, select: { id_condominio: true } });
    if (!existe) throw new NotFoundException('Unidade não encontrada.');
    this.assertMesmoCondominio(existe.id_condominio, porteiro);
    const apto = await this.aptoComModulo(idApartamento);
    if (!apto) throw moduloDesligado();
    const segredos = this.segredos();
    const agora = this.agora();

    const c = await this.prisma.interfone_Chamadas.create({
      data: {
        id_condominio: apto.id_condominio,
        tipo: 'portaria_unidade',
        estado: 'chamando',
        id_apartamento: apto.id,
        id_porteiro_origem: porteiro.uid,
        created_at: new Date(agora),
      },
    });
    const moradores = await this.nucleo.moradoresDaUnidade(apto.id);
    // "Sem app" pelos aparelhos (não pelo APNs, que pode levar segundos).
    const [alcancaveis, monitores] = await Promise.all([
      this.push.podemTocar(moradores),
      this.prisma.interfone_Monitores.count({ where: { id_apartamento: apto.id, ativo: 1 } }),
    ]);
    if (alcancaveis.length === 0 && monitores === 0) {
      await this.prisma.interfone_Chamadas.update({
        where: { id: c.id },
        data: { estado: 'encerrada', resultado: 'falha', encerrada_em: new Date(agora), duracao_s: 0 },
      });
      throw conflito('sem_app', 'Nenhum morador da unidade atende pelo app.');
    }
    this.nucleo.emSegundoPlano(`toque da ligação ${c.id}`, async () => {
      const r = await this.push.tocar(c.id, moradores, {
        tipo: 'portaria_unidade',
        unidade: rotuloAptoBloco(apto.apto, apto.bloco),
        portao: 'Portaria',
        condominio: apto.condominio.nome,
      });
      await this.nucleo.gravarTocou(c.id, r.ids);
      await this.nucleo.avaliarRecusas(c.id);
    });
    return this.dadosEntrada(c.id, 'origem', porteiro.uid, porteiro.nome, segredos, agora);
  }

  /** Um "ligar" por vez por quem liga (toque duplo não cria duas chamadas). */
  private async comTrava<T>(chave: string, fn: () => Promise<T>): Promise<T> {
    const agora = this.agora();
    const t = this.ligando.get(chave);
    if (t && agora - t < LIGAR_TRAVA_MS) throw conflito('em_andamento', 'Já existe uma ligação em andamento.');
    this.ligando.set(chave, agora);
    try {
      const r = await fn();
      // Segura mais 5 s depois da resposta (o segundo toque chega depois do primeiro terminar).
      this.ligando.set(chave, this.agora());
      return r;
    } catch (e) {
      // Pedido recusado (sem porteiro, sem app…) não trava a nova tentativa.
      this.ligando.delete(chave);
      throw e;
    }
  }

  // ─────────────────────────────────────────── consultas

  async historico(idUser: number, idApartamento: number): Promise<ItemHistorico[]> {
    const vinculo = await this.assertVinculo(idUser, idApartamento);
    if (!(await this.aptoComModulo(idApartamento))) throw moduloDesligado();
    // 30 dias, mas nunca de antes de o morador entrar na unidade (created_at ou, se o vínculo mudou de unidade, updated_at).
    let desde = this.agora() - HISTORICO_DIAS * DIA_MS;
    for (const d of [vinculo.created_at, vinculo.updated_at]) if (d instanceof Date) desde = Math.max(desde, d.getTime());
    const lista = await this.prisma.interfone_Chamadas.findMany({
      where: { id_apartamento: idApartamento, created_at: { gte: new Date(desde) } },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: HISTORICO_MAX,
    });
    return Promise.all(lista.map((c) => this.item(c)));
  }

  /** Console: chamadas de hoje (Brasília) do condomínio. */
  async hoje(idCondominio: number): Promise<(ItemHistorico & { unidade: string; estado: string })[]> {
    await this.assertModulo(idCondominio);
    const { inicio, fim } = intervaloHojeBrasilia(new Date(this.agora()));
    const lista = await this.prisma.interfone_Chamadas.findMany({
      where: { id_condominio: idCondominio, created_at: { gte: inicio, lte: fim } },
      include: { apartamento: { select: { apto: true, bloco: true } } },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: HOJE_MAX,
    });
    return Promise.all(lista.map(async (c) => ({ ...(await this.item(c)), estado: c.estado, unidade: unidadeDaChamada(c) })));
  }

  async estadoParaApp(id: number, idUser: number) {
    const c = await this.nucleo.carregar(id);
    if (!c) throw new NotFoundException('Chamada não encontrada.');
    await this.assertVinculo(idUser, c.id_apartamento);
    return {
      id: c.id,
      tipo: c.tipo,
      estado: c.estado,
      resultado: c.resultado ?? null,
      unidade: unidadeDaChamada(c),
      portao: c.facial?.nome ?? 'Portaria',
      foto_url: await this.assinar(c.foto),
      atendida_por_mim: c.atendida_por_tipo === 'morador' && c.atendida_por_id === idUser,
    };
  }

  async preferencia(idUser: number): Promise<{ receber: boolean }> {
    const u = await this.prisma.users.findUnique({ where: { id: idUser }, select: { interfone_receber: true } });
    if (!u) throw new NotFoundException('Usuário não encontrado.');
    return { receber: u.interfone_receber !== 0 };
  }

  async definirPreferencia(idUser: number, receber: boolean): Promise<{ receber: boolean }> {
    await this.prisma.users.update({ where: { id: idUser }, data: { interfone_receber: receber ? 1 : 0 } });
    return { receber };
  }

  /**
   * O app mostra o interfone? Vínculo com a unidade (existir a linha em Apartamentos_Users; o vencimento é só
   * exibição no resto do sistema) em condomínio com o módulo contratado e ligado.
   */
  async disponivel(idUser: number): Promise<{ ativo: boolean }> {
    const v = await this.prisma.apartamentos_Users.findFirst({
      where: {
        id_user: idUser,
        apartamento: { condominio: { ativo: 1, interfone_contratado: 1, interfone_ativo: 1 } },
      },
      select: { id: true },
    });
    return { ativo: !!v };
  }

  // ─────────────────────────────────────────── apoio

  private async item(c: {
    id: number;
    tipo: string;
    created_at: Date;
    resultado: string | null;
    atendida_por_nome: string | null;
    foto: string | null;
    porta_aberta_em: Date | null;
  }): Promise<ItemHistorico> {
    return {
      id: c.id,
      tipo: c.tipo,
      inicio: c.created_at,
      resultado: c.resultado ?? null,
      atendida_por_nome: c.atendida_por_nome ?? null,
      foto_url: await this.assinar(c.foto),
      porta_aberta: !!c.porta_aberta_em,
    };
  }

  /** Link assinado da foto (bucket privado); null sem foto ou se assinar falhar. */
  private async assinar(foto: string | null | undefined): Promise<string | null> {
    if (!foto) return null;
    try {
      return this.storage ? await this.storage.assinarUrl(foto) : foto;
    } catch {
      return null;
    }
  }

  private segredos(): { token: string; turn: string } {
    const token = process.env['VOZ_TOKEN_SECRET'];
    const turn = process.env['VOZ_TURN_SECRET'];
    if (!token || !turn) {
      this.logger.warn('Interfone: VOZ_TOKEN_SECRET/VOZ_TURN_SECRET ausentes; atender e ligar recusados.');
      throw new ServiceUnavailableException('Interfone indisponível no momento.');
    }
    return { token, turn };
  }

  private dadosEntrada(
    id: number,
    papel: PapelVoz,
    uid: number,
    nome: string,
    segredos: { token: string; turn: string },
    agora: number,
  ): DadosEntrada {
    const seg = Math.floor(agora / 1000);
    const token = assinarTokenVoz({ cid: id, papel, uid, nome: (nome || '').slice(0, 120) }, segredos.token, seg);
    return montarDadosEntrada(id, token, credencialTurn(uid, segredos.turn, seg));
  }

  /** Morador: vínculo com a unidade da chamada. Porteiro: mesmo condomínio. */
  private async assertPodeVer(c: { id_condominio: number; id_apartamento: number | null }, quem: Quem) {
    if (quem.papel === 'portaria') this.assertMesmoCondominio(c.id_condominio, quem);
    else await this.assertVinculo(quem.uid, c.id_apartamento);
  }

  private assertMesmoCondominio(idCondominio: number, porteiro: QuemPortaria) {
    if (!porteiro.idCondominio || porteiro.idCondominio !== idCondominio) {
      throw new ForbiddenException('Acesso negado: chamada de outro condomínio.');
    }
  }

  /** Vínculo = existir a linha em Apartamentos_Users; o vencimento não conta (todo vínculo do app nasce com +45 dias). */
  private async assertVinculo(idUser: number, idApartamento: number | null | undefined): Promise<{ id: number; created_at: Date | null; updated_at: Date | null }> {
    if (!idApartamento || !Number.isInteger(idUser) || idUser <= 0) throw new ForbiddenException('Acesso negado à unidade.');
    const v = await this.prisma.apartamentos_Users.findFirst({
      where: {
        id_apto: idApartamento,
        id_user: idUser,
      },
      select: { id: true, created_at: true, updated_at: true },
    });
    if (!v) throw new ForbiddenException('Acesso negado à unidade.');
    return v;
  }

  /**
   * 403 `modulo_desligado` se o condomínio não está ativo com o interfone
   * contratado e ligado. Toda rota da portaria e do app (menos `disponivel`,
   * que responde `ativo: false`) passa por aqui.
   */
  async assertModulo(idCondominio: number | null | undefined): Promise<void> {
    if (!idCondominio || !Number.isInteger(idCondominio)) throw moduloDesligado();
    const cond = await this.prisma.condominios.findUnique({
      where: { id: idCondominio },
      select: { ativo: true, interfone_contratado: true, interfone_ativo: true },
    });
    if (!moduloLigado(cond)) throw moduloDesligado();
  }

  /** Unidade com o condomínio, se o módulo está contratado, ligado e o condomínio ativo. */
  private async aptoComModulo(idApartamento: number) {
    const apto = await this.prisma.apartamentos.findFirst({
      where: { id: idApartamento },
      select: {
        id: true,
        apto: true,
        bloco: true,
        id_condominio: true,
        condominio: { select: { nome: true, ativo: true, interfone_contratado: true, interfone_ativo: true } },
      },
    });
    const cond = apto?.condominio;
    if (!apto || !cond || !moduloLigado(cond)) return null;
    return { ...apto, condominio: cond };
  }

  private lerRecusas(json: string | null | undefined): number[] {
    if (!json) return [];
    try {
      const v = JSON.parse(json);
      return Array.isArray(v) ? v.filter((n) => Number.isInteger(n)) : [];
    } catch {
      return [];
    }
  }
}

function moduloLigado(
  c: { ativo: number | null; interfone_contratado: number | null; interfone_ativo: number | null } | null | undefined,
): boolean {
  return !!c && c.ativo === 1 && c.interfone_contratado === 1 && c.interfone_ativo === 1;
}
