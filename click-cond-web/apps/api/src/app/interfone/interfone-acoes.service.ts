import {
  BadRequestException,
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
import { AuditoriaService, type AuditoriaAutorTipo } from '../auditoria/auditoria.service';
import { StorageService } from '../common/storage/storage.service';
import { hojeBrasilia, intervaloHojeBrasilia } from '../common/hora-brasilia.util';
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
export interface QuemCentral {
  papel: 'central';
  /** Central_Operadores.id */
  uid: number;
  nome: string;
}
export type Quem = QuemMorador | QuemPortaria | QuemCentral;

/** Por que o operador da central abriu o portão: obrigatório para ele e gravado na auditoria. */
export const MOTIVOS_ABERTURA = ['visitante_identificado', 'entrega', 'prestador', 'morador_sem_acesso', 'emergencia', 'outro'] as const;
export type MotivoAbertura = (typeof MOTIVOS_ABERTURA)[number];
export interface MotivoAberturaPedido {
  codigo: MotivoAbertura;
  /** Obrigatório quando `codigo === 'outro'`. */
  detalhe?: string;
}
const DETALHE_MOTIVO_MAX = 255;

/** Tipos de chamada que o porteiro do prédio e o operador da central atendem na portaria. */
const TIPOS_NA_PORTARIA: readonly string[] = ['facial_unidade', 'facial_portaria', 'unidade_portaria'];
/** Tipos de chamada com portão (o facial da chamada) para abrir. */
const TIPOS_COM_PORTAO: readonly string[] = ['facial_unidade', 'facial_portaria'];

/**
 * Pedido do portão: autorizar só abre com a chamada ativa ou encerrada há até 5 min (conta do
 * `encerrada_em`). Chamada encerrada sem horário de fim gravado: fora da janela (falha fechado).
 */
export const PEDIDO_JANELA_MS = 5 * 60_000;
export function chamadaNaJanelaDoPedido(c: { estado: string; encerrada_em: Date | null }, agoraMs: number): boolean {
  if (c.estado !== 'encerrada') return true;
  return !!c.encerrada_em && agoraMs - c.encerrada_em.getTime() <= PEDIDO_JANELA_MS;
}

const AUTOR_TIPO: Record<Quem['papel'], AuditoriaAutorTipo> = {
  morador: 'user',
  portaria: 'funcionario_portaria',
  central: 'operador_central',
};
const ROTULO_AUTOR: Record<Quem['papel'], string> = { morador: 'Morador', portaria: 'Portaria', central: 'Central' };

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

/** Item da lista de chamadas do console (hoje ou um dia anterior). */
export type ItemConsole = ItemHistorico & {
  unidade: string;
  estado: string;
  /** Para ligar de volta; null quando a unidade foi apagada ou a chamada não tem unidade. */
  id_apartamento: number | null;
  porta_aberta_por_nome: string | null;
};

function conflito(motivo: string, message: string): ConflictException {
  return new ConflictException({ statusCode: 409, motivo, message });
}

/** 409 de quando a chamada é disputada entre o porteiro do prédio e a central. */
function atendidaPorOutro(): ConflictException {
  return conflito('atendida_por_outro', 'Outra pessoa atendeu esta chamada.');
}

/** Motivo de abertura da central: código da lista; `outro` exige o detalhe. 400 antes de qualquer consulta. */
export function validarMotivoAbertura(m: unknown): MotivoAberturaPedido {
  const o = (m && typeof m === 'object' ? m : {}) as Record<string, unknown>;
  const codigo = typeof o['codigo'] === 'string' ? o['codigo'].trim() : '';
  const erro = (motivo: string, message: string) => new BadRequestException({ statusCode: 400, motivo, message });
  if (!codigo) throw erro('motivo_obrigatorio', 'Informe o motivo da abertura do portão.');
  if (!(MOTIVOS_ABERTURA as readonly string[]).includes(codigo)) throw erro('motivo_invalido', 'Motivo de abertura inválido.');
  const detalhe = typeof o['detalhe'] === 'string' ? o['detalhe'].trim().slice(0, DETALHE_MOTIVO_MAX) : '';
  if (codigo === 'outro' && !detalhe) throw erro('motivo_obrigatorio', 'Descreva o motivo da abertura do portão.');
  return detalhe ? { codigo: codigo as MotivoAbertura, detalhe } : { codigo: codigo as MotivoAbertura };
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

  /**
   * Central (`QuemCentral`): só em condomínio com `central_contratada = 1`, chamada na portaria
   * (`facial_unidade`, `facial_portaria` ou `unidade_portaria`). Porteiro do prédio e operador
   * disputam a mesma reserva: o primeiro vence e o outro recebe 409 `atendida_por_outro`.
   */
  async atender(id: number, quem: Quem): Promise<DadosEntrada> {
    if (quem.papel === 'portaria') await this.assertModulo(quem.idCondominio);
    const c = await this.nucleo.carregar(id);
    if (!c) throw new NotFoundException('Chamada não encontrada.');
    await this.assertPodeVer(c, quem);
    if (quem.papel !== 'portaria') await this.assertModulo(c.id_condominio);
    if (c.estado === 'encerrada') throw conflito('encerrada', 'A chamada já terminou.');
    if (c.estado === 'atendida') {
      // O mesmo operador que já entrou (reconexão do console): mesmos dados de entrada, token novo.
      if (quem.papel === 'central' && c.atendida_por_tipo === 'central' && c.atendida_por_id === quem.uid) {
        return this.dadosEntrada(c.id, quem.papel, quem.uid, quem.nome, this.segredos(), this.agora());
      }
      if (quem.papel === 'central' || c.atendida_por_tipo === 'central') throw atendidaPorOutro();
      throw conflito('ja_atendida', 'A chamada já foi atendida.');
    }

    const pode =
      quem.papel === 'morador'
        ? c.estado === 'chamando' && (c.tipo === 'facial_unidade' || c.tipo === 'portaria_unidade')
        : c.estado === 'portaria' && TIPOS_NA_PORTARIA.includes(c.tipo);
    if (!pode) throw conflito('ja_atendida', 'A chamada não está disponível para você.');

    const segredos = this.segredos();
    const agora = this.agora();
    // Reserva vale só no estado atual: se a chamada for para a portaria, o
    // pedido do morador não segura o porteiro.
    if (!this.nucleo.reservar(c.id, `${quem.papel}:${quem.uid}`, c.estado, agora)) {
      const dono = this.nucleo.donoDaReserva(c.id, c.estado, agora) ?? '';
      if (quem.papel === 'central' || dono.startsWith('central:')) throw atendidaPorOutro();
      throw conflito('ja_atendida', 'Já atendida em outro aparelho.');
    }
    if (quem.papel === 'central') {
      // Operador que pegou a chamada. Condicional: quem já entrou na mídia não é sobrescrito; se
      // outro papel entrar depois (a reserva venceu), o "atendida" do núcleo limpa o campo.
      await this.prisma.interfone_Chamadas.updateMany({
        where: { id: c.id, estado: 'portaria', atendida_em: null },
        data: { id_operador_central: quem.uid },
      });
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

  /**
   * `motivo`: obrigatório para a central (400 `motivo_obrigatorio` / `motivo_invalido`, antes de
   * qualquer consulta) e gravado na auditoria; morador e porteiro não mandam.
   */
  async abrir(id: number, quem: Quem, motivo?: MotivoAberturaPedido | null): Promise<{ ok: boolean; motivo?: string }> {
    const motivoCentral = quem.papel === 'central' ? validarMotivoAbertura(motivo) : null;
    // O módulo é reconferido a cada abertura, antes de acionar o portão: desligado
    // (ou condomínio desativado) no meio da conversa não abre, nem dentro dos 210 s.
    // A recusa vem antes do contador de aberturas e não gasta nenhuma das 3.
    if (quem.papel === 'portaria') await this.assertModulo(quem.idCondominio);
    const c = await this.nucleo.carregar(id);
    if (!c) return { ok: false, motivo: 'chamada_nao_encontrada' };
    await this.assertPodeVer(c, quem);
    if (quem.papel !== 'portaria') await this.assertModulo(c.id_condominio);
    if (c.estado !== 'atendida') return { ok: false, motivo: 'chamada_nao_atendida' };
    if (c.atendida_por_tipo !== quem.papel || c.atendida_por_id !== quem.uid) {
      return { ok: false, motivo: 'atendida_por_outro' };
    }
    if (!temPortao(c)) return { ok: false, motivo: 'sem_portao' };
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
    const aberto = await this.abrirPortaoDaChamada(c, unidade, quem, {
      descricao: `Portão "${c.facial.nome}" aberto pelo interfone${quem.papel === 'central' ? ' pela central' : ''} (${unidade || 'sem unidade'})`,
      detalhes: motivoCentral ? { motivo: motivoCentral } : {},
    });
    return aberto ? { ok: true } : { ok: false, motivo: 'falha_ao_abrir' };
  }

  /**
   * Pedido do portão: o morador autorizou pelo app. Mesmo caminho físico do `abrir` (agente → relé,
   * DTMF de reserva), sem exigir que o morador tenha atendido a chamada, só no portão do facial da
   * chamada e só na janela do pedido (chamada ativa ou encerrada há até 5 min). Não passa pelo
   * limite de aberturas de quem atendeu: quem garante "uma vez" é o InterfonePedidosService (troca
   * condicional pendente → autorizado antes de chamar aqui), que também confere o vínculo do morador
   * com a unidade do pedido. Nenhuma rota chama isto direto.
   */
  async abrirPorPedido(
    idChamada: number,
    morador: { uid: number; nome: string },
    extra: { idPedido?: number; unidade?: string } = {},
  ): Promise<{ ok: boolean; motivo?: string }> {
    const c = await this.nucleo.carregar(idChamada);
    if (!c) return { ok: false, motivo: 'chamada_nao_encontrada' };
    try {
      await this.assertModulo(c.id_condominio);
    } catch {
      return { ok: false, motivo: 'modulo_desligado' };
    }
    if (!chamadaNaJanelaDoPedido(c, this.agora())) return { ok: false, motivo: 'chamada_expirada' };
    if (!temPortao(c)) return { ok: false, motivo: 'sem_portao' };
    if (!this.facial) return { ok: false, motivo: 'indisponivel' };
    // facial_portaria não tem unidade na chamada: vale a que a central escolheu no pedido.
    const unidade = extra.unidade || unidadeDaChamada(c);
    const nome = (morador.nome || '').trim() || 'Morador';
    const aberto = await this.abrirPortaoDaChamada(c, unidade, { papel: 'morador', uid: morador.uid, nome }, {
      descricao: `Portão "${c.facial.nome}" aberto por autorização do morador ${nome} (pedido do interfone) — ${unidade || 'sem unidade'}`,
      detalhes: { pedido: true, ...(extra.idPedido ? { id_pedido: extra.idPedido } : {}) },
    });
    return aberto ? { ok: true } : { ok: false, motivo: 'falha_ao_abrir' };
  }

  /**
   * Parte física de abrir o portão do facial da chamada, comum ao `abrir` e ao `abrirPorPedido`:
   * agente local (relé) e, se falhar e o facial tiver DTMF, o DTMF pela ligação; grava a abertura
   * na chamada (`porta_aberta_*`) e a auditoria INTERFONE_ABRIR. Quem chama já conferiu quem pode,
   * o portão e a janela. False se nada abriu (nada é gravado).
   */
  private async abrirPortaoDaChamada(
    c: ChamadaComPortao,
    unidade: string,
    autor: { papel: Quem['papel']; uid: number; nome: string },
    registro: { descricao: string; detalhes: Record<string, unknown> },
  ): Promise<boolean> {
    if (!this.facial) return false;
    // facial_portaria não tem unidade: o visitante discou a portaria.
    const ctx = { origem: 'interfone' as const, tipoPessoa: 'visitante', nomePessoa: `Interfone ${unidade || 'portaria'}`.trim() };
    let como: 'agente' | 'dtmf' | null = null;
    const r = await this.facial.abrirDispositivoInterno(c.id_facial, ctx);
    if (r.ok) como = 'agente';
    else if (c.facial.interfone_dtmf && (await this.voz.dtmf(c.id, c.facial.interfone_dtmf))) {
      como = 'dtmf';
      // O histórico de acessos já tem a falha do agente; registra a abertura que deu certo.
      await this.facial.registrarAberturaExterna(c.id_facial, { ...ctx, nota: 'DTMF' });
    }
    if (!como) return false;

    const agora = new Date(this.agora());
    await this.prisma.interfone_Chamadas.update({
      where: { id: c.id },
      data: { porta_aberta_em: agora, porta_aberta_por_nome: (autor.nome || '').slice(0, 120) || null, porta_aberta_como: como },
    });
    await this.auditoria?.registrar({
      id_condominio: c.id_condominio,
      usuario_nome: autor.nome || ROTULO_AUTOR[autor.papel],
      autor_id: autor.uid,
      autor_tipo: AUTOR_TIPO[autor.papel],
      acao: 'INTERFONE_ABRIR',
      modulo: 'interfone',
      entidade_id: c.id,
      descricao: registro.descricao,
      detalhes: { como, papel: autor.papel, id_facial: c.id_facial, ...registro.detalhes },
    });
    return true;
  }

  /**
   * Console (porteiro do seu condomínio) ou central (condomínio com a central contratada): encerra
   * só a chamada que está na portaria, a que ele atendeu ou a que ele originou (não derruba a
   * conversa do morador nem a chamada que ainda toca no apartamento).
   */
  async encerrarPortaria(id: number, quem: QuemPortaria | QuemCentral): Promise<{ ok: boolean }> {
    if (quem.papel === 'portaria') await this.assertModulo(quem.idCondominio);
    const c = await this.nucleo.carregar(id);
    if (!c) throw new NotFoundException('Chamada não encontrada.');
    await this.assertPodeVer(c, quem);
    if (quem.papel === 'central') await this.assertModulo(c.id_condominio);
    if (c.estado === 'encerrada') return { ok: true };
    const originou =
      quem.papel === 'portaria'
        ? c.id_porteiro_origem === quem.uid
        : c.tipo === 'portaria_unidade' && c.id_operador_central === quem.uid;
    const dele =
      c.estado === 'portaria' ||
      (c.atendida_por_tipo === quem.papel && c.atendida_por_id === quem.uid) ||
      originou;
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
        // Ligação do app para a portaria: sempre o console do prédio (exige porteiro online).
        destino: 'local',
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

  /** Console: o porteiro liga para uma unidade do seu condomínio. Central: unidade de condomínio com a central. */
  async ligarUnidade(quem: QuemPortaria | QuemCentral, idApartamento: number): Promise<DadosEntrada> {
    return this.comTrava(`${quem.papel}:${quem.uid}`, () => this.ligarUnidadeSemTrava(quem, idApartamento));
  }

  private async ligarUnidadeSemTrava(quem: QuemPortaria | QuemCentral, idApartamento: number): Promise<DadosEntrada> {
    if (quem.papel === 'portaria') await this.assertModulo(quem.idCondominio);
    const existe = await this.prisma.apartamentos.findFirst({
      where: { id: idApartamento },
      select: { id_condominio: true, condominio: { select: { central_contratada: true } } },
    });
    if (!existe) throw new NotFoundException('Unidade não encontrada.');
    if (quem.papel === 'portaria') this.assertMesmoCondominio(existe.id_condominio, quem);
    else this.assertCentral(existe);
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
        ...(quem.papel === 'portaria'
          ? { id_porteiro_origem: quem.uid, destino: 'local' }
          : { id_operador_central: quem.uid, destino: 'central' }),
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
    return this.dadosEntrada(c.id, 'origem', quem.uid, quem.nome, segredos, agora);
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
  async hoje(idCondominio: number): Promise<ItemConsole[]> {
    await this.assertModulo(idCondominio);
    return this.chamadasDoDia(idCondominio, new Date(this.agora()));
  }

  /**
   * Console: chamadas de um dia (AAAA-MM-DD, calendário de Brasília) de hoje até HISTORICO_DIAS atrás — o mesmo
   * limite do histórico do app do morador. Só leitura: a lista de hoje (que reconcilia o toque) não muda.
   */
  async dia(idCondominio: number, data: string): Promise<ItemConsole[]> {
    await this.assertModulo(idCondominio);
    return this.chamadasDoDia(idCondominio, this.instanteDoDia(data));
  }

  /**
   * Um instante dentro do dia pedido (AAAA-MM-DD, calendário de Brasília), de hoje até
   * HISTORICO_DIAS atrás; 400 fora disso. Também usado pelo histórico da central.
   */
  instanteDoDia(data: string): Date {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(data ?? ''));
    const pedido = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
    const valido = m && new Date(pedido).toISOString().slice(0, 10) === data;
    const hoje = hojeBrasilia(new Date(this.agora())).getTime();
    if (!valido || pedido > hoje || pedido < hoje - HISTORICO_DIAS * DIA_MS) {
      throw new BadRequestException(`Escolha uma data de hoje até ${HISTORICO_DIAS} dias atrás.`);
    }
    // Meio-dia UTC do dia pedido = 09h em Brasília: cai sempre dentro do dia civil pedido.
    return new Date(pedido + 12 * 3_600_000);
  }

  private async chamadasDoDia(idCondominio: number, instante: Date): Promise<ItemConsole[]> {
    const { inicio, fim } = intervaloHojeBrasilia(instante);
    const lista = await this.prisma.interfone_Chamadas.findMany({
      where: { id_condominio: idCondominio, created_at: { gte: inicio, lte: fim } },
      include: { apartamento: { select: { apto: true, bloco: true } } },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: HOJE_MAX,
    });
    return Promise.all(
      lista.map(async (c) => ({
        ...(await this.item(c)),
        estado: c.estado,
        unidade: unidadeDaChamada(c),
        id_apartamento: c.id_apartamento ?? null,
        porta_aberta_por_nome: c.porta_aberta_por_nome ?? null,
      })),
    );
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

  /** Morador: vínculo com a unidade da chamada. Porteiro: mesmo condomínio. Central: condomínio com a central. */
  private async assertPodeVer(c: ChamadaParaVer, quem: Quem) {
    if (quem.papel === 'portaria') this.assertMesmoCondominio(c.id_condominio, quem);
    else if (quem.papel === 'central') this.assertChamadaDaCentral(c, quem.uid);
    else await this.assertVinculo(quem.uid, c.id_apartamento);
  }

  /**
   * Central: só chamada de condomínio com a central contratada E encaminhada para a central
   * (`destino = 'central'`) — ou a do próprio operador (ele ligou ou atendeu). Chamada que a agenda
   * mandou para o porteiro do prédio não é da central.
   */
  assertChamadaDaCentral(c: ChamadaParaVer, uid: number): void {
    this.assertCentral(c);
    if (c.destino !== 'central' && c.id_operador_central !== uid) {
      throw new ForbiddenException('Acesso negado: esta chamada não foi encaminhada para a central.');
    }
  }

  /** O operador só vê condomínio que contratou a central (o módulo ligado é conferido à parte). */
  assertCentral(c: { condominio?: { central_contratada?: number | null } | null }): void {
    if (c.condominio?.central_contratada !== 1) {
      throw new ForbiddenException('Acesso negado: este condomínio não contratou a central.');
    }
  }

  private assertMesmoCondominio(idCondominio: number, porteiro: QuemPortaria) {
    if (!porteiro.idCondominio || porteiro.idCondominio !== idCondominio) {
      throw new ForbiddenException('Acesso negado: chamada de outro condomínio.');
    }
  }

  /** Vínculo = existir a linha em Apartamentos_Users; o vencimento não conta (todo vínculo do app nasce com +45 dias). */
  async assertVinculo(idUser: number, idApartamento: number | null | undefined): Promise<{ id: number; created_at: Date | null; updated_at: Date | null }> {
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

type ChamadaCarregada = NonNullable<Awaited<ReturnType<InterfoneService['carregar']>>>;
/** Chamada de facial (facial_unidade, facial_portaria) com o facial ainda cadastrado: tem portão para abrir. */
type ChamadaComPortao = ChamadaCarregada & { id_facial: number; facial: NonNullable<ChamadaCarregada['facial']> };
function temPortao(c: ChamadaCarregada): c is ChamadaComPortao {
  return TIPOS_COM_PORTAO.includes(c.tipo) && !!c.id_facial && !!c.facial;
}

/** O que as conferências de acesso leem da chamada. */
type ChamadaParaVer = {
  id_condominio: number;
  id_apartamento: number | null;
  destino?: string | null;
  id_operador_central?: number | null;
  condominio?: { central_contratada?: number | null } | null;
};

function moduloLigado(
  c: { ativo: number | null; interfone_contratado: number | null; interfone_ativo: number | null } | null | undefined,
): boolean {
  return !!c && c.ativo === 1 && c.interfone_contratado === 1 && c.interfone_ativo === 1;
}
