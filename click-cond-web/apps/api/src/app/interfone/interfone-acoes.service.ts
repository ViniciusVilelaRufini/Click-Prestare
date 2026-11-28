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
import { hojeBrasilia, intervaloHojeBrasilia } from '../common/hora-brasilia.util';
import { rotuloAptoBloco } from '../visitantes/rotulo-apto-bloco.util';
import { InterfoneService, unidadeDaChamada } from './interfone.service';
import { InterfonePushService } from './interfone-push.service';
import { VozControleClient } from './voz-controle.client';
import { DadosEntrada, PapelVoz, assinarTokenVoz, credencialTurn, montarDadosEntrada } from './token-voz';

/** Quem pediu "atender" fica com a chamada por este tempo; outro pedido recebe 409. */
export const RESERVA_ATENDER_MS = 15_000;
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
  /** Reserva do "atender" (uma réplica da API; ver RealtimeGateway). */
  private readonly reservas = new Map<number, { chave: string; ate: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly nucleo: InterfoneService,
    private readonly push: InterfonePushService,
    private readonly voz: VozControleClient,
    @Optional() private readonly facial?: FacialService,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  // ─────────────────────────────────────────── atender / recusar / abrir

  async atender(id: number, quem: Quem): Promise<DadosEntrada> {
    const c = await this.nucleo.carregar(id);
    if (!c) throw new NotFoundException('Chamada não encontrada.');
    await this.assertPodeVer(c, quem);
    if (c.estado === 'encerrada') throw conflito('encerrada', 'A chamada já terminou.');
    if (c.estado === 'atendida') throw conflito('ja_atendida', 'A chamada já foi atendida.');

    const pode =
      quem.papel === 'morador'
        ? c.estado === 'chamando' && (c.tipo === 'facial_unidade' || c.tipo === 'portaria_unidade')
        : c.estado === 'portaria' && (c.tipo === 'facial_unidade' || c.tipo === 'unidade_portaria');
    if (!pode) throw conflito('ja_atendida', 'A chamada não está disponível para você.');

    const segredos = this.segredos();
    const agora = this.agora();
    const chave = `${quem.papel}:${quem.uid}`;
    const r = this.reservas.get(c.id);
    if (r && r.ate > agora && r.chave !== chave) throw conflito('ja_atendida', 'Já atendida em outro aparelho.');
    this.reservas.set(c.id, { chave, ate: agora + RESERVA_ATENDER_MS });
    this.limparReservas(agora);

    return this.dadosEntrada(c.id, quem.papel, quem.uid, quem.nome, segredos, agora);
  }

  async recusar(id: number, idUser: number): Promise<{ ok: true }> {
    const c = await this.nucleo.carregar(id);
    if (!c) throw new NotFoundException('Chamada não encontrada.');
    await this.assertVinculo(idUser, c.id_apartamento);
    if (c.estado !== 'chamando' || (c.tipo !== 'facial_unidade' && c.tipo !== 'portaria_unidade')) return { ok: true };

    const recusas = new Set<number>(this.lerRecusas(c.recusas));
    recusas.add(idUser);
    await this.prisma.interfone_Chamadas.update({ where: { id: c.id }, data: { recusas: JSON.stringify([...recusas]) } });

    // Todos que podiam tocar recusaram? (moradores vigentes que não desligaram o interfone)
    const tocados = await this.prisma.users.findMany({
      where: {
        id: { in: await this.nucleo.moradoresDaUnidade(c.id_apartamento as number) },
        interfone_receber: 1,
      },
      select: { id: true },
    });
    if (!tocados.length || !tocados.every((u) => recusas.has(u.id))) return { ok: true };

    const transfere =
      c.tipo === 'facial_unidade' &&
      c.condominio?.interfone_transferir === 1 &&
      (await this.nucleo.porteirosOnline(c.id_condominio));
    if (!transfere) {
      await this.voz.encerrar(c.id);
      return { ok: true };
    }
    const r = await this.prisma.interfone_Chamadas.updateMany({
      where: { id: c.id, estado: 'chamando' },
      data: { estado: 'portaria', motivo_portaria: 'recusou' },
    });
    if (r.count === 0) return { ok: true };
    await this.nucleo.emitirChamadaPortaria(c, 'recusou');
    await this.voz.portaria(c.id);
    return { ok: true };
  }

  async abrir(id: number, quem: Quem): Promise<{ ok: boolean; motivo?: string }> {
    const c = await this.nucleo.carregar(id);
    if (!c) return { ok: false, motivo: 'chamada_nao_encontrada' };
    await this.assertPodeVer(c, quem);
    if (c.estado !== 'atendida') return { ok: false, motivo: 'chamada_nao_atendida' };
    if (c.atendida_por_tipo !== quem.papel || c.atendida_por_id !== quem.uid) {
      return { ok: false, motivo: 'atendida_por_outro' };
    }
    if (c.tipo !== 'facial_unidade' || !c.id_facial || !c.facial) return { ok: false, motivo: 'sem_portao' };
    if (!this.facial) return { ok: false, motivo: 'indisponivel' };

    const unidade = unidadeDaChamada(c);
    let como: 'agente' | 'dtmf' | null = null;
    const r = await this.facial.abrirDispositivoInterno(c.id_facial, {
      origem: 'interfone',
      tipoPessoa: 'visitante',
      nomePessoa: `Interfone ${unidade}`.trim(),
    });
    if (r.ok) como = 'agente';
    else if (c.facial.interfone_dtmf && (await this.voz.dtmf(c.id, c.facial.interfone_dtmf))) como = 'dtmf';
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

  /** Console: o porteiro encerra a chamada do seu condomínio. */
  async encerrarPortaria(id: number, porteiro: QuemPortaria): Promise<{ ok: boolean }> {
    const c = await this.nucleo.carregar(id);
    if (!c) throw new NotFoundException('Chamada não encontrada.');
    this.assertMesmoCondominio(c.id_condominio, porteiro);
    if (c.estado === 'encerrada') return { ok: true };
    return { ok: await this.voz.encerrar(c.id) };
  }

  // ─────────────────────────────────────────── ligar

  /** App: o morador liga para a portaria do condomínio da unidade. */
  async ligarPortaria(quem: QuemMorador, idApartamento: number): Promise<DadosEntrada> {
    await this.assertVinculo(quem.uid, idApartamento);
    const apto = await this.aptoComModulo(idApartamento);
    if (!apto) throw conflito('portaria_indisponivel', 'O interfone não está ligado neste condomínio.');
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
    const existe = await this.prisma.apartamentos.findFirst({ where: { id: idApartamento }, select: { id_condominio: true } });
    if (!existe) throw new NotFoundException('Unidade não encontrada.');
    this.assertMesmoCondominio(existe.id_condominio, porteiro);
    const apto = await this.aptoComModulo(idApartamento);
    if (!apto) throw conflito('indisponivel', 'O interfone não está ligado neste condomínio.');
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
    const [r, monitores] = await Promise.all([
      this.push.tocar(c.id, moradores, {
        tipo: 'portaria_unidade',
        unidade: rotuloAptoBloco(apto.apto, apto.bloco),
        portao: 'Portaria',
        condominio: apto.condominio.nome,
      }),
      this.prisma.interfone_Monitores.count({ where: { id_apartamento: apto.id, ativo: 1 } }),
    ]);
    if (r.tocou === 0 && monitores === 0) {
      await this.prisma.interfone_Chamadas.update({
        where: { id: c.id },
        data: { estado: 'encerrada', resultado: 'falha', encerrada_em: new Date(agora), duracao_s: 0 },
      });
      throw conflito('sem_app', 'Nenhum morador da unidade atende pelo app.');
    }
    return this.dadosEntrada(c.id, 'origem', porteiro.uid, porteiro.nome, segredos, agora);
  }

  // ─────────────────────────────────────────── consultas

  async historico(idUser: number, idApartamento: number): Promise<ItemHistorico[]> {
    await this.assertVinculo(idUser, idApartamento);
    const lista = await this.prisma.interfone_Chamadas.findMany({
      where: { id_apartamento: idApartamento, created_at: { gte: new Date(this.agora() - HISTORICO_DIAS * DIA_MS) } },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: HISTORICO_MAX,
    });
    return lista.map((c) => this.item(c));
  }

  /** Console: chamadas de hoje (Brasília) do condomínio. */
  async hoje(idCondominio: number): Promise<(ItemHistorico & { unidade: string; estado: string })[]> {
    const { inicio, fim } = intervaloHojeBrasilia(new Date(this.agora()));
    const lista = await this.prisma.interfone_Chamadas.findMany({
      where: { id_condominio: idCondominio, created_at: { gte: inicio, lte: fim } },
      include: { apartamento: { select: { apto: true, bloco: true } } },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: HOJE_MAX,
    });
    return lista.map((c) => ({ ...this.item(c), estado: c.estado, unidade: unidadeDaChamada(c) }));
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
      foto_url: c.foto ?? null,
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

  /** O app mostra o interfone? Vínculo vigente em condomínio com o módulo contratado e ligado. */
  async disponivel(idUser: number): Promise<{ ativo: boolean }> {
    const v = await this.prisma.apartamentos_Users.findFirst({
      where: {
        id_user: idUser,
        OR: [{ vencimento: null }, { vencimento: { gte: hojeBrasilia(new Date(this.agora())) } }],
        apartamento: { condominio: { ativo: 1, interfone_contratado: 1, interfone_ativo: 1 } },
      },
      select: { id: true },
    });
    return { ativo: !!v };
  }

  // ─────────────────────────────────────────── apoio

  private item(c: {
    id: number;
    tipo: string;
    created_at: Date;
    resultado: string | null;
    atendida_por_nome: string | null;
    foto: string | null;
    porta_aberta_em: Date | null;
  }): ItemHistorico {
    return {
      id: c.id,
      tipo: c.tipo,
      inicio: c.created_at,
      resultado: c.resultado ?? null,
      atendida_por_nome: c.atendida_por_nome ?? null,
      foto_url: c.foto ?? null,
      porta_aberta: !!c.porta_aberta_em,
    };
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

  /** Morador: vínculo vigente com a unidade da chamada. Porteiro: mesmo condomínio. */
  private async assertPodeVer(c: { id_condominio: number; id_apartamento: number | null }, quem: Quem) {
    if (quem.papel === 'portaria') this.assertMesmoCondominio(c.id_condominio, quem);
    else await this.assertVinculo(quem.uid, c.id_apartamento);
  }

  private assertMesmoCondominio(idCondominio: number, porteiro: QuemPortaria) {
    if (!porteiro.idCondominio || porteiro.idCondominio !== idCondominio) {
      throw new ForbiddenException('Acesso negado: chamada de outro condomínio.');
    }
  }

  private async assertVinculo(idUser: number, idApartamento: number | null | undefined) {
    if (!idApartamento || !Number.isInteger(idUser) || idUser <= 0) throw new ForbiddenException('Acesso negado à unidade.');
    const v = await this.prisma.apartamentos_Users.findFirst({
      where: {
        id_apto: idApartamento,
        id_user: idUser,
        OR: [{ vencimento: null }, { vencimento: { gte: hojeBrasilia(new Date(this.agora())) } }],
      },
      select: { id: true },
    });
    if (!v) throw new ForbiddenException('Acesso negado à unidade.');
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
    if (!apto || !cond || cond.ativo !== 1 || cond.interfone_contratado !== 1 || cond.interfone_ativo !== 1) return null;
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

  private limparReservas(agora: number) {
    if (this.reservas.size < 200) return;
    for (const [k, r] of this.reservas) if (r.ate <= agora) this.reservas.delete(k);
  }
}
