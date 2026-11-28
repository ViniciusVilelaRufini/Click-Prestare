import { ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../common/storage/storage.service';
import { intervaloHojeBrasilia } from '../common/hora-brasilia.util';
import { diaPermitido, diaSemanaBrt } from '../facial/escolha-visita.util';
import type { DestinoPortaria } from '../interfone/destino-portaria';
import {
  ChamadaCentralEvento,
  InterfoneService,
  ORFA_APOS_MS,
  horaBrasiliaHHMM,
  unidadeDaChamada,
} from '../interfone/interfone.service';
import { InterfoneAcoesService } from '../interfone/interfone-acoes.service';
import type { MotivoAberturaPedido, QuemCentral } from '../interfone/interfone-acoes.service';
import type { DadosEntrada } from '../interfone/token-voz';

/** Operador logado (de `operadorDoToken`). */
export interface OperadorCentral {
  uid: number;
  nome: string;
}

export interface CondominioDaCentral {
  id: number;
  nome: string;
  destino: DestinoPortaria;
}

export interface EsperadoHoje {
  nome: string;
  /** HH:MM (Brasília) do início da visita ou da previsão da entrega; null sem hora no dia. */
  horario: string | null;
  tipo: 'convite' | 'entrega';
}

/**
 * O que o operador vê ao atender (LGPD: o mínimo). Nunca telefone, e-mail nem documento — nem do
 * morador, nem do visitante, nem do entregador.
 */
export interface ContextoChamada {
  condominio: string;
  portao: string | null;
  unidade: string;
  /** Primeiro nome dos moradores da unidade. */
  moradores: string[];
  esperados_hoje: EsperadoHoje[];
  instrucao_entregas: string | null;
}

export interface ItemHistoricoCentral {
  id: number;
  tipo: string;
  inicio: Date;
  estado: string;
  resultado: string | null;
  atendida_por_nome: string | null;
  foto_url: string | null;
  porta_aberta: boolean;
  porta_aberta_por_nome: string | null;
  unidade: string;
  id_apartamento: number | null;
  id_condominio: number;
  condominio: string;
  portao: string | null;
}

export interface AlertaCentral {
  id: number;
  id_condominio: number;
  condominio: string;
  tipo: string;
  descricao: string;
  created_at: Date;
  visto_em: Date | null;
  visto_por: string | null;
}

/** Tipos de chamada que esperam alguém na portaria. */
const TIPOS_FILA = ['facial_unidade', 'facial_portaria', 'unidade_portaria'];
/** Entrega ainda por acontecer (delivery_atendimentos.status). */
const STATUS_ENTREGA_ESPERADA = ['AGENDADA', 'CHEGOU', 'AGUARDANDO_AUTORIZACAO'];
const FILA_MAX = 200;
const HISTORICO_MAX = 500;
const ALERTAS_MAX = 100;
const ESPERADOS_MAX = 20;
const VISTO_POR_MAX = 120;

/** Condomínio atendido pela central agora: contratou e está ativo. */
const ONDE_CENTRAL = { central_contratada: 1, ativo: 1 } as const;

function primeiroNome(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const p = v.trim().split(/\s+/)[0];
  return p ? p.slice(0, 60) : null;
}

/**
 * Central de portaria (portaria autônoma, Entrega 1): o operador atende vários condomínios. Toda
 * consulta é limitada aos condomínios com `central_contratada = 1` (e ativos); as ações sobre a
 * chamada passam pelo InterfoneAcoesService com `QuemCentral`, que confere o mesmo por chamada.
 */
@Injectable()
export class CentralService {
  private readonly logger = new Logger(CentralService.name);
  /** Público para os testes; em produção é Date.now. */
  agora: () => number = () => Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly nucleo: InterfoneService,
    private readonly acoes: InterfoneAcoesService,
    @Optional() private readonly storage?: StorageService,
  ) {}

  private quem(op: OperadorCentral): QuemCentral {
    return { papel: 'central', uid: op.uid, nome: op.nome };
  }

  // ─────────────────────────────────────────── condomínios e fila

  /** Condomínios da central, com para onde vai a portaria agora (agenda + salvaguarda). */
  async condominios(): Promise<CondominioDaCentral[]> {
    const conds = await this.prisma.condominios.findMany({
      where: ONDE_CENTRAL,
      select: { id: true, nome: true },
      orderBy: { nome: 'asc' },
    });
    const agora = new Date(this.agora());
    return Promise.all(
      conds.map(async (c) => {
        let destino: DestinoPortaria = 'central';
        try {
          destino = await this.nucleo.destinoPortaria(c.id, agora);
        } catch (e) {
          // Mesma regra do núcleo: agenda ilegível em condomínio da central → central.
          this.logger.warn(`Central: destino do condomínio ${c.id} não veio do banco: ${(e as Error)?.message ?? e}`);
        }
        return { id: c.id, nome: c.nome, destino };
      }),
    );
  }

  /**
   * Chamadas esperando na portaria encaminhadas para a central (`destino = 'central'`), nos
   * condomínios da central com o interfone ligado, mais antigas primeiro. A que a agenda mandou para
   * o porteiro do prédio não aparece.
   */
  async fila(): Promise<ChamadaCentralEvento[]> {
    const conds = await this.prisma.condominios.findMany({
      where: { ...ONDE_CENTRAL, interfone_contratado: 1, interfone_ativo: 1 },
      select: { id: true },
    });
    if (!conds.length) return [];
    const lista = await this.prisma.interfone_Chamadas.findMany({
      where: {
        estado: 'portaria',
        destino: 'central',
        tipo: { in: TIPOS_FILA },
        id_condominio: { in: conds.map((c) => c.id) },
        // Na portaria além do prazo é órfã (a rotina do núcleo encerra): não aparece na fila.
        created_at: { gte: new Date(this.agora() - ORFA_APOS_MS.portaria) },
      },
      include: {
        condominio: { select: { nome: true } },
        apartamento: { select: { apto: true, bloco: true } },
        facial: { select: { nome: true } },
      },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      take: FILA_MAX,
    });
    // Ligação do app para a portaria: só o primeiro nome de quem ligou.
    const origens = [...new Set(lista.map((c) => c.id_user_origem).filter((u): u is number => Number.isInteger(u)))];
    const nomes = new Map<number, string | null>();
    if (origens.length) {
      const us = await this.prisma.users.findMany({ where: { id: { in: origens } }, select: { id: true, name: true } });
      for (const u of us) nomes.set(u.id, primeiroNome(u.name));
    }
    return Promise.all(
      lista.map(async (c) => ({
        id: c.id,
        tipo: c.tipo,
        unidade: unidadeDaChamada(c),
        motivo: c.motivo_portaria ?? null,
        morador_nome: c.id_user_origem ? (nomes.get(c.id_user_origem) ?? null) : null,
        foto_url: await this.assinar(c.foto),
        id_condominio: c.id_condominio,
        condominio: c.condominio?.nome ?? '',
        portao: c.facial?.nome ?? null,
        criada_em: c.created_at.toISOString(),
      })),
    );
  }

  // ─────────────────────────────────────────── ações na chamada

  atender(op: OperadorCentral, id: number): Promise<DadosEntrada> {
    return this.acoes.atender(id, this.quem(op));
  }

  abrir(op: OperadorCentral, id: number, motivo: MotivoAberturaPedido | null | undefined) {
    return this.acoes.abrir(id, this.quem(op), motivo);
  }

  encerrar(op: OperadorCentral, id: number) {
    return this.acoes.encerrarPortaria(id, this.quem(op));
  }

  ligar(op: OperadorCentral, idApartamento: number): Promise<DadosEntrada> {
    return this.acoes.ligarUnidade(this.quem(op), idApartamento);
  }

  // ─────────────────────────────────────────── contexto

  /**
   * O que o operador precisa para decidir: só da chamada encaminhada para a central (ou do próprio
   * operador) que está na portaria, que ele atendeu ou que ele ligou e ainda está em curso, em
   * condomínio da central. Sem telefone, e-mail nem documento (LGPD).
   */
  async contexto(op: OperadorCentral, id: number): Promise<ContextoChamada> {
    const c = await this.nucleo.carregar(id);
    if (!c) throw new NotFoundException('Chamada não encontrada.');
    this.acoes.assertChamadaDaCentral(c, op.uid);
    await this.acoes.assertModulo(c.id_condominio);
    const comigo =
      c.estado === 'portaria' ||
      (c.estado === 'atendida' && c.atendida_por_tipo === 'central' && c.atendida_por_id === op.uid) ||
      // Ligação que o operador fez para a unidade (tocando ou em conversa com o morador).
      (c.tipo === 'portaria_unidade' && c.id_operador_central === op.uid && c.estado !== 'encerrada');
    if (!comigo) throw new ForbiddenException('Esta chamada não está com a central.');

    const [cond, moradores, esperados] = await Promise.all([
      this.prisma.condominios.findUnique({ where: { id: c.id_condominio }, select: { instrucao_entregas: true } }),
      c.id_apartamento ? this.primeirosNomes(c.id_apartamento) : Promise.resolve([]),
      c.id_apartamento ? this.esperadosHoje(c.id_apartamento) : Promise.resolve([]),
    ]);
    return {
      condominio: c.condominio?.nome ?? '',
      portao: c.facial?.nome ?? null,
      unidade: unidadeDaChamada(c),
      moradores,
      esperados_hoje: esperados,
      instrucao_entregas: cond?.instrucao_entregas?.trim() || null,
    };
  }

  private async primeirosNomes(idApartamento: number): Promise<string[]> {
    const us = await this.prisma.users.findMany({
      where: { apartamentosUsers: { some: { id_apto: idApartamento } } },
      select: { name: true },
      orderBy: { id: 'asc' },
    });
    return [...new Set(us.map((u) => primeiroNome(u.name)).filter((n): n is string => !!n))];
  }

  /**
   * Convites (Visitas e o cadastro antigo de Visitantes) e entregas de hoje para a unidade. Convite
   * só liberado (pendente, negado ou revogado não entra) e, se recorrente, só no dia da semana de
   * hoje (Brasília).
   */
  private async esperadosHoje(idApartamento: number): Promise<EsperadoHoje[]> {
    const agora = this.agora();
    const { inicio, fim } = intervaloHojeBrasilia(new Date(agora));
    const hoje = { diaSemana: diaSemanaBrt(agora) };
    const janela = {
      bloqueado: 0,
      liberado: 1,
      data_saida: null,
      OR: [
        { data_hora_inicio: { gte: inicio, lte: fim } },
        { data_hora_inicio: { lte: fim }, data_hora_termino: { gte: inicio } },
      ],
    };
    const [visitas, antigos, entregas] = await Promise.all([
      this.prisma.visitas.findMany({
        where: { id_apartamento: idApartamento, ...janela },
        select: { data_hora_inicio: true, dias_semana: true, pessoa: { select: { nome: true } } },
        take: ESPERADOS_MAX,
      }),
      this.prisma.visitantes.findMany({
        where: { id_apartamento: idApartamento, ...janela },
        select: { nome: true, data_hora_inicio: true, dias_semana: true },
        take: ESPERADOS_MAX,
      }),
      this.prisma.deliveryAtendimentos.findMany({
        where: {
          id_apartamento: idApartamento,
          status: { in: STATUS_ENTREGA_ESPERADA },
          OR: [{ previsao_em: { gte: inicio, lte: fim } }, { previsao_em: null, created_at: { gte: inicio, lte: fim } }],
        },
        select: { estabelecimento: true, previsao_em: true },
        take: ESPERADOS_MAX,
      }),
    ]);
    // Hora só quando cai no dia (visita de vários dias que começou antes: sem hora).
    const hora = (d: Date | null | undefined) => (d && d >= inicio && d <= fim ? horaBrasiliaHHMM(d) : null);
    const lista: EsperadoHoje[] = [
      ...visitas.filter((v) => diaPermitido(v, hoje)).map((v) => ({ nome: String(v.pessoa?.nome ?? '').trim(), horario: hora(v.data_hora_inicio), tipo: 'convite' as const })),
      ...antigos.filter((v) => diaPermitido(v, hoje)).map((v) => ({ nome: String(v.nome ?? '').trim(), horario: hora(v.data_hora_inicio), tipo: 'convite' as const })),
      ...entregas.map((e) => ({ nome: String(e.estabelecimento ?? '').trim() || 'Entrega', horario: hora(e.previsao_em), tipo: 'entrega' as const })),
    ].filter((x) => x.nome);
    lista.sort((a, b) => {
      if (a.horario !== b.horario) {
        if (a.horario === null) return 1;
        if (b.horario === null) return -1;
        return a.horario < b.horario ? -1 : 1;
      }
      return a.nome.localeCompare(b.nome, 'pt-BR');
    });
    return lista.slice(0, ESPERADOS_MAX).map((x) => ({ ...x, nome: x.nome.slice(0, 120) }));
  }

  // ─────────────────────────────────────────── histórico

  /**
   * Chamadas do dia (AAAA-MM-DD, até 30 dias atrás) atendidas pela central ou originadas por ela,
   * nos condomínios ativos que hoje contratam a central.
   */
  async historico(data: string): Promise<ItemHistoricoCentral[]> {
    const { inicio, fim } = intervaloHojeBrasilia(this.acoes.instanteDoDia(data));
    const conds = await this.prisma.condominios.findMany({ where: ONDE_CENTRAL, select: { id: true } });
    if (!conds.length) return [];
    const lista = await this.prisma.interfone_Chamadas.findMany({
      where: {
        created_at: { gte: inicio, lte: fim },
        id_condominio: { in: conds.map((c) => c.id) },
        OR: [{ atendida_por_tipo: 'central' }, { tipo: 'portaria_unidade', id_operador_central: { not: null } }],
      },
      include: {
        condominio: { select: { nome: true } },
        apartamento: { select: { apto: true, bloco: true } },
        facial: { select: { nome: true } },
      },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: HISTORICO_MAX,
    });
    return Promise.all(
      lista.map(async (c) => ({
        id: c.id,
        tipo: c.tipo,
        inicio: c.created_at,
        estado: c.estado,
        resultado: c.resultado ?? null,
        atendida_por_nome: c.atendida_por_nome ?? null,
        foto_url: await this.assinar(c.foto),
        porta_aberta: !!c.porta_aberta_em,
        porta_aberta_por_nome: c.porta_aberta_por_nome ?? null,
        unidade: unidadeDaChamada(c),
        id_apartamento: c.id_apartamento ?? null,
        id_condominio: c.id_condominio,
        condominio: c.condominio?.nome ?? '',
        portao: c.facial?.nome ?? null,
      })),
    );
  }

  // ─────────────────────────────────────────── alertas do Guarita

  /** Alertas dos condomínios da central (100 mais novos). Sem os dados brutos do frame. */
  async alertas(soPendentes: boolean): Promise<AlertaCentral[]> {
    const conds = await this.prisma.condominios.findMany({ where: ONDE_CENTRAL, select: { id: true } });
    if (!conds.length) return [];
    const lista = await this.prisma.guarita_Alertas.findMany({
      where: { id_condominio: { in: conds.map((c) => c.id) }, ...(soPendentes ? { visto_em: null } : {}) },
      include: { condominio: { select: { nome: true } } },
      orderBy: { id: 'desc' },
      take: ALERTAS_MAX,
    });
    return lista.map((a) => ({
      id: a.id,
      id_condominio: a.id_condominio,
      condominio: a.condominio?.nome ?? '',
      tipo: a.tipo,
      descricao: a.descricao,
      created_at: a.created_at,
      visto_em: a.visto_em ?? null,
      visto_por: a.visto_por ?? null,
    }));
  }

  /** Marca como visto (uma vez: quem viu primeiro fica). Alerta fora dos condomínios da central → 404. */
  async alertaVisto(op: OperadorCentral, id: number): Promise<{ ok: true }> {
    const a = await this.prisma.guarita_Alertas.findFirst({
      where: { id, condominio: ONDE_CENTRAL },
      select: { id: true },
    });
    if (!a) throw new NotFoundException('Alerta não encontrado.');
    await this.prisma.guarita_Alertas.updateMany({
      where: { id: a.id, visto_em: null },
      data: { visto_em: new Date(this.agora()), visto_por: `Central: ${op.nome || 'operador'}`.slice(0, VISTO_POR_MAX) },
    });
    return { ok: true };
  }

  // ─────────────────────────────────────────── apoio

  /** Link assinado da foto (bucket privado); null sem foto ou se assinar falhar. */
  private async assinar(foto: string | null | undefined): Promise<string | null> {
    if (!foto) return null;
    try {
      return this.storage ? await this.storage.assinarUrl(foto) : foto;
    } catch {
      return null;
    }
  }
}
