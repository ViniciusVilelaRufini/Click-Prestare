import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { StorageService } from '../common/storage/storage.service';
import { hojeBrasilia } from '../common/hora-brasilia.util';
import { executarComLock } from '../common/lock-distribuido';
import { rotuloAptoBloco } from '../visitantes/rotulo-apto-bloco.util';
import { normalizarFabricante } from '../facial/fabricantes';
import { InterfonePushService } from './interfone-push.service';
import { VozControleClient } from './voz-controle.client';
import { facialAtendeBloco, ramalValido } from './regras';

/** Anti-trote (Global Constraints do plano). */
export const LIMITE_POR_FACIAL_MIN = 6;
export const LIMITE_POR_UNIDADE_5MIN = 3;
const MIN_MS = 60_000;
/**
 * Rede de segurança: chamada não terminal mais velha que isto é dada como
 * `falha` (o serviço de voz reiniciou e perdeu o `encerrada`). Bem acima do
 * pior caso real (60 s de toque + 120 s na portaria + 180 s de conversa).
 */
export const ORFA_APOS_MS = 10 * MIN_MS;
const ORFAS_VERIFICA_MS = MIN_MS;

/** Tempos de toque: [mínimo, máximo, padrão] em segundos. */
export const TOQUE_APTO_S = [15, 60, 30] as const;
export const TOQUE_PORTARIA_S = [15, 120, 45] as const;

export const RESULTADOS = ['atendida_morador', 'atendida_portaria', 'nao_atendida', 'recusada', 'falha', 'cancelada'] as const;
export type ResultadoChamada = (typeof RESULTADOS)[number];
/** Quem pode "entrar" numa chamada pelo serviço de voz (o monitor IP também atende). */
const PAPEIS_ATENDE = ['morador', 'portaria', 'monitor'] as const;

export type EventoServico =
  | { evento: 'atendida'; papel: string; uid: number }
  | { evento: 'toque_esgotado' }
  | { evento: 'encerrada'; resultado: string; duracao_s: number };

export type NovaChamadaFacial =
  | { ok: true; id: number; toque_s: number; monitores: string[] }
  | { ok: false; motivo: 'nao_encontrado' | 'indisponivel' | 'limite' };

/** Foto do visitante pelo facial (Task A6). Nunca deve atrasar o toque. */
export interface CapturadorFotoInterfone {
  capturar(idChamada: number, device: { id: number; [k: string]: unknown }): Promise<void>;
}

function limitar(v: unknown, [min, max, padrao]: readonly [number, number, number]): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return padrao;
  return Math.min(max, Math.max(min, Math.round(n)));
}

const FMT_HORA = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false });

/** "HH:MM" no horário de Brasília. */
export function horaBrasiliaHHMM(d: Date): string {
  return FMT_HORA.format(d);
}

const INCLUDE_CHAMADA = {
  condominio: {
    select: { id: true, nome: true, interfone_transferir: true, interfone_toque_apto_s: true, interfone_toque_portaria_s: true },
  },
  apartamento: { select: { id: true, apto: true, bloco: true } },
  facial: { select: { id: true, nome: true } },
} as const;

const contaFacial = (id: number) => `fac-${id}`;
const contaMonitor = (id: number) => `mon-${id}`;

/**
 * Núcleo das chamadas do interfone. A API é dona dos dados: decide quem toca,
 * manda push, avisa o console e grava o registro. O serviço de voz (Asterisk +
 * ARI) só cuida da mídia e consulta/avisa a API pelas rotas internas.
 */
@Injectable()
export class InterfoneService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InterfoneService.name);
  private orfasInterval?: ReturnType<typeof setInterval>;
  /** Público para os testes; em produção é Date.now. */
  agora: () => number = () => Date.now();
  /** Público para os testes (esperas da transferência em segundo plano). */
  dormir: (ms: number) => Promise<void> = (ms) =>
    new Promise((r) => {
      const t = setTimeout(r, ms);
      t.unref?.();
    });
  /**
   * Tentativas de forçar a portaria logo depois de responder ao serviço: o
   * serviço só conhece a chamada depois de receber o id, então a primeira
   * tentativa espera um pouco.
   */
  esperasPortariaMs = [800, 1500, 3000];
  /** Foto do visitante (Task A6 preenche com o InterfoneFotoService). */
  foto: CapturadorFotoInterfone | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: InterfonePushService,
    private readonly voz: VozControleClient,
    @Optional() private readonly realtime?: RealtimeGateway,
    @Optional() private readonly storage?: StorageService,
  ) {}

  onModuleInit() {
    if (process.env['NODE_ENV'] === 'test') return;
    this.orfasInterval = setInterval(
      () => void executarComLock(this.prisma, 'interfone:orfas', async () => void (await this.fecharOrfas())),
      ORFAS_VERIFICA_MS,
    );
    this.orfasInterval.unref?.();
  }

  onModuleDestroy() {
    if (this.orfasInterval) clearInterval(this.orfasInterval);
  }

  /**
   * Fecha como `falha` as chamadas em estado não terminal criadas há mais de
   * ORFA_APOS_MS, com o mesmo efeito do `encerrada` (push `fim`, evento
   * `interfone:fim`). Devolve quantas fechou. Nunca lança.
   */
  async fecharOrfas(): Promise<number> {
    let fechadas = 0;
    try {
      const orfas = await this.prisma.interfone_Chamadas.findMany({
        where: { estado: { in: ['chamando', 'portaria', 'atendida'] }, created_at: { lt: new Date(this.agora() - ORFA_APOS_MS) } },
        include: INCLUDE_CHAMADA,
        orderBy: { id: 'asc' },
        take: 200,
      });
      for (const c of orfas) {
        try {
          if (await this.fecharComo(c, 'falha', null)) fechadas++;
        } catch (e: any) {
          this.logger.warn(`Interfone: não fechou a chamada órfã ${c.id}: ${e?.message ?? e}`);
        }
      }
      if (fechadas) this.logger.warn(`Interfone: ${fechadas} chamada(s) órfã(s) fechada(s) como falha.`);
    } catch (e: any) {
      this.logger.warn(`Interfone: rotina de chamadas órfãs falhou: ${e?.message ?? e}`);
    }
    return fechadas;
  }

  // ─────────────────────────────────────────── chamada do facial

  async novaChamadaFacial(conta: string, numero: string): Promise<NovaChamadaFacial> {
    const m = /^fac-(\d{1,10})$/.exec(String(conta ?? ''));
    if (!m) return { ok: false, motivo: 'indisponivel' };
    const idFacial = Number(m[1]);

    const facial = await this.prisma.facial_Devices.findFirst({
      where: { id: idFacial },
      select: {
        id: true,
        nome: true,
        ativo: true,
        id_condominio: true,
        fabricante: true,
        ip: true,
        porta: true,
        interfone_habilitado: true,
        interfone_blocos: true,
        condominio: {
          select: {
            nome: true,
            ativo: true,
            interfone_contratado: true,
            interfone_ativo: true,
            interfone_toque_apto_s: true,
            interfone_transferir: true,
          },
        },
      },
    });
    const cond = facial?.condominio;
    if (
      !facial ||
      !cond ||
      facial.ativo !== 1 ||
      facial.interfone_habilitado !== 1 ||
      cond.ativo !== 1 ||
      cond.interfone_contratado !== 1 ||
      cond.interfone_ativo !== 1
    ) {
      return { ok: false, motivo: 'indisponivel' };
    }

    const num = String(numero ?? '').trim();
    if (!ramalValido(num)) return { ok: false, motivo: 'nao_encontrado' };

    const agora = this.agora();
    const doFacial = await this.prisma.interfone_Chamadas.count({
      where: { id_facial: facial.id, created_at: { gte: new Date(agora - MIN_MS) } },
    });
    if (doFacial >= LIMITE_POR_FACIAL_MIN) return { ok: false, motivo: 'limite' };

    const apto = await this.prisma.apartamentos.findFirst({
      where: { id_condominio: facial.id_condominio, interfone_ramal: num },
      select: { id: true, apto: true, bloco: true },
    });
    if (!apto || !facialAtendeBloco(facial.interfone_blocos, apto.bloco)) return { ok: false, motivo: 'nao_encontrado' };

    const daUnidade = await this.prisma.interfone_Chamadas.count({
      where: { id_apartamento: apto.id, tipo: 'facial_unidade', created_at: { gte: new Date(agora - 5 * MIN_MS) } },
    });
    if (daUnidade >= LIMITE_POR_UNIDADE_5MIN) return { ok: false, motivo: 'limite' };

    const chamada = await this.prisma.interfone_Chamadas.create({
      data: {
        id_condominio: facial.id_condominio,
        tipo: 'facial_unidade',
        estado: 'chamando',
        id_facial: facial.id,
        id_apartamento: apto.id,
        numero_discado: num,
        created_at: new Date(agora),
      },
    });

    // Foto do visitante: disparada sem esperar; nunca atrasa nem derruba o toque.
    if (this.foto) {
      void this.foto
        .capturar(chamada.id, facial)
        .catch((e: any) => this.logger.warn(`Interfone: foto da chamada ${chamada.id} falhou: ${e?.message ?? e}`));
    }

    const unidade = rotuloAptoBloco(apto.apto, apto.bloco);
    const [moradores, monitores] = await Promise.all([this.moradoresDaUnidade(apto.id), this.monitoresDaUnidade(apto.id)]);
    const r = await this.push.tocar(chamada.id, moradores, {
      tipo: 'facial_unidade',
      unidade,
      portao: facial.nome,
      condominio: cond.nome,
    });

    // Nenhum celular tocou (sem app novo, push falhou, ninguém com vínculo) e
    // não há monitor na unidade: vai direto para a portaria, se houver.
    if (r.tocou === 0 && monitores.length === 0) {
      await this.prisma.interfone_Chamadas.update({ where: { id: chamada.id }, data: { motivo_portaria: 'sem_app' } });
      if (cond.interfone_transferir === 1) await this.transferirSemApp(chamada.id, facial.id_condominio, unidade);
    }

    return { ok: true, id: chamada.id, toque_s: limitar(cond.interfone_toque_apto_s, TOQUE_APTO_S), monitores };
  }

  /**
   * Sem ninguém para tocar: se o condomínio transfere e há porteiro no
   * console, marca `portaria`, avisa o console e pede ao serviço para tocar
   * lá (em segundo plano: o serviço ainda não recebeu o id). Sem porteiro,
   * deixa tocar — o toque esgota e o serviço encerra com "ninguém atendeu".
   */
  private async transferirSemApp(id: number, idCondominio: number, unidade: string) {
    if (!(await this.porteirosOnline(idCondominio))) return;
    const r = await this.prisma.interfone_Chamadas.updateMany({ where: { id, estado: 'chamando' }, data: { estado: 'portaria' } });
    if (r.count === 0) return;
    this.realtime?.emitirPortaria(idCondominio, 'interfone:chamada', {
      id,
      tipo: 'facial_unidade',
      unidade,
      motivo: 'sem_app',
      morador_nome: null,
      foto_url: null,
    });
    void (async () => {
      for (const ms of this.esperasPortariaMs) {
        await this.dormir(ms);
        if (await this.voz.portaria(id)) return;
      }
      this.logger.warn(`Interfone: serviço de voz não aceitou levar a chamada ${id} para a portaria.`);
    })().catch(() => undefined);
  }

  // ─────────────────────────────────────────── eventos do serviço

  async evento(id: number, ev: EventoServico): Promise<{ proximo: 'portaria' | 'encerrar' } | { ok: true }> {
    const tipo = (ev as any)?.evento;
    if (tipo !== 'atendida' && tipo !== 'toque_esgotado' && tipo !== 'encerrada') {
      throw new BadRequestException('Evento inválido.');
    }
    const c = await this.carregar(id);
    if (!c) throw new NotFoundException('Chamada não encontrada.');
    if (tipo === 'atendida') return this.atendida(c, ev as Extract<EventoServico, { evento: 'atendida' }>);
    if (tipo === 'toque_esgotado') return this.toqueEsgotado(c);
    return this.encerrada(c, ev as Extract<EventoServico, { evento: 'encerrada' }>);
  }

  private async atendida(c: ChamadaCarregada, ev: { papel: string; uid: number }): Promise<{ ok: true }> {
    const papel = ev?.papel;
    const uid = Number(ev?.uid);
    if (!(PAPEIS_ATENDE as readonly string[]).includes(papel) || !Number.isInteger(uid) || uid <= 0) {
      throw new BadRequestException('Quem atendeu é inválido.');
    }
    const nome = await this.nomeDe(papel as (typeof PAPEIS_ATENDE)[number], uid);
    // Condicional: o primeiro que entra ganha; o segundo evento não sobrescreve.
    const r = await this.prisma.interfone_Chamadas.updateMany({
      where: { id: c.id, atendida_em: null, estado: { in: ['chamando', 'portaria'] } },
      data: {
        estado: 'atendida',
        atendida_em: new Date(this.agora()),
        atendida_por_tipo: papel,
        atendida_por_id: uid,
        atendida_por_nome: nome ? nome.slice(0, 120) : null,
      },
    });
    if (r.count === 0) return { ok: true };
    const tocados = await this.tocadosDaChamada(c);
    await this.push.fim(
      c.id,
      tocados.filter((u) => !(papel === 'morador' && u === uid)),
    );
    this.realtime?.emitirPortaria(c.id_condominio, 'interfone:fim', { id: c.id });
    return { ok: true };
  }

  private async toqueEsgotado(c: ChamadaCarregada): Promise<{ proximo: 'portaria' | 'encerrar' }> {
    // Só o toque da unidade chamada pelo facial transfere (a portaria que liga
    // para a unidade não transfere para si mesma).
    if (c.estado !== 'chamando' || c.tipo !== 'facial_unidade') return { proximo: 'encerrar' };
    if (c.condominio?.interfone_transferir !== 1 || !(await this.porteirosOnline(c.id_condominio))) {
      return { proximo: 'encerrar' };
    }
    const motivo = c.motivo_portaria ?? 'nao_atendeu';
    const r = await this.prisma.interfone_Chamadas.updateMany({
      where: { id: c.id, estado: 'chamando' },
      data: { estado: 'portaria', motivo_portaria: motivo },
    });
    if (r.count === 0) return { proximo: 'encerrar' };
    // Os celulares param: na portaria o morador não atende mais.
    await this.push.fim(c.id, await this.tocadosDaChamada(c));
    this.realtime?.emitirPortaria(c.id_condominio, 'interfone:chamada', {
      id: c.id,
      tipo: c.tipo,
      unidade: this.unidadeDe(c),
      motivo,
      morador_nome: null,
      foto_url: await this.fotoUrl(c.foto),
    });
    return { proximo: 'portaria' };
  }

  private async encerrada(c: ChamadaCarregada, ev: { resultado: string; duracao_s: number }): Promise<{ ok: true }> {
    const resultado = ev?.resultado;
    if (!(RESULTADOS as readonly string[]).includes(resultado)) throw new BadRequestException('Resultado inválido.');
    const dur = Number(ev?.duracao_s);
    const duracao = Number.isFinite(dur) && dur >= 0 ? Math.min(Math.round(dur), 24 * 3600) : null;
    await this.fecharComo(c, resultado as ResultadoChamada, duracao);
    return { ok: true };
  }

  /** Encerra (uma vez só) e para tudo: push `fim`, `interfone:fim` e, se não atendida, o aviso de perdida. */
  private async fecharComo(c: ChamadaCarregada, resultado: ResultadoChamada, duracao: number | null): Promise<boolean> {
    const r = await this.prisma.interfone_Chamadas.updateMany({
      where: { id: c.id, estado: { not: 'encerrada' } },
      data: { estado: 'encerrada', resultado, duracao_s: duracao, encerrada_em: new Date(this.agora()) },
    });
    if (r.count === 0) return false;
    const tocados = await this.tocadosDaChamada(c);
    await this.push.fim(c.id, tocados);
    this.realtime?.emitirPortaria(c.id_condominio, 'interfone:fim', { id: c.id });
    if (resultado === 'nao_atendida' && c.tipo === 'facial_unidade') {
      await this.push.perdida(c.id, tocados, horaBrasiliaHHMM(c.created_at));
    }
    return true;
  }

  // ─────────────────────────────────────────── consultas do serviço

  async dadosParaServico(id: number) {
    const c = await this.carregar(id);
    if (!c) throw new NotFoundException('Chamada não encontrada.');
    const comMonitor = c.tipo === 'facial_unidade' && c.id_apartamento;
    return {
      id: c.id,
      tipo: c.tipo,
      estado: c.estado,
      toque_s: limitar(c.condominio?.interfone_toque_apto_s, TOQUE_APTO_S),
      toque_portaria_s: limitar(c.condominio?.interfone_toque_portaria_s, TOQUE_PORTARIA_S),
      monitores: comMonitor ? await this.monitoresDaUnidade(c.id_apartamento as number) : [],
    };
  }

  /** Contas SIP que o serviço registra: faciais habilitados e monitores de condomínios com o módulo ligado. */
  async contas() {
    const condOk = { ativo: 1, interfone_contratado: 1, interfone_ativo: 1 };
    const [faciais, monitores] = await Promise.all([
      this.prisma.facial_Devices.findMany({
        where: { interfone_habilitado: 1, ativo: 1, interfone_senha: { not: null }, condominio: condOk },
        select: { id: true, id_condominio: true, fabricante: true, interfone_senha: true },
        orderBy: { id: 'asc' },
      }),
      this.prisma.interfone_Monitores.findMany({
        where: { ativo: 1, condominio: condOk },
        select: { id: true, id_condominio: true, id_apartamento: true, senha: true },
        orderBy: { id: 'asc' },
      }),
    ]);
    return {
      faciais: faciais.map((f) => ({
        conta: contaFacial(f.id),
        senha: f.interfone_senha as string,
        id_condominio: f.id_condominio,
        // Intelbras/Dahua mandam o DTMF por SIP INFO; os demais, RFC 4733.
        dtmf_modo: normalizarFabricante(f.fabricante) === 'intelbras' ? ('info' as const) : ('rfc4733' as const),
      })),
      monitores: monitores.map((m) => ({
        conta: contaMonitor(m.id),
        senha: m.senha,
        id_condominio: m.id_condominio,
        id_apartamento: m.id_apartamento,
      })),
    };
  }

  /** Estado de registro das contas na central. Só os faciais guardam (o console mostra). */
  async registros(contas: { conta: string; registrado: boolean }[]): Promise<{ ok: true; atualizados: number }> {
    if (!Array.isArray(contas)) throw new BadRequestException('contas deve ser uma lista.');
    let atualizados = 0;
    const agora = new Date(this.agora());
    for (const item of contas.slice(0, 5000)) {
      const m = /^fac-(\d{1,10})$/.exec(String(item?.conta ?? ''));
      if (!m) continue;
      const id = Number(m[1]);
      const r =
        item.registrado === true
          ? await this.prisma.facial_Devices.updateMany({
              where: { id, interfone_registrado: 0 },
              data: { interfone_registrado: 1, interfone_registrado_em: agora },
            })
          : await this.prisma.facial_Devices.updateMany({
              where: { id, interfone_registrado: 1 },
              data: { interfone_registrado: 0 },
            });
      atualizados += r.count;
    }
    return { ok: true, atualizados };
  }

  // ─────────────────────────────────────────── apoio

  /** Há porteiro com o console aberto? Sem gateway (testes, boot) = não. */
  async porteirosOnline(idCondominio: number): Promise<boolean> {
    return (await this.realtime?.porteirosOnline(idCondominio)) ?? false;
  }

  /** Moradores com vínculo vigente na unidade (vencimento nulo ou de hoje em diante, em Brasília). */
  async moradoresDaUnidade(idApartamento: number): Promise<number[]> {
    const usuarios = await this.prisma.users.findMany({
      where: {
        apartamentosUsers: {
          some: { id_apto: idApartamento, OR: [{ vencimento: null }, { vencimento: { gte: hojeBrasilia(new Date(this.agora())) } }] },
        },
      },
      select: { id: true },
    });
    return usuarios.map((u) => u.id);
  }

  private async monitoresDaUnidade(idApartamento: number): Promise<string[]> {
    const ms = await this.prisma.interfone_Monitores.findMany({
      where: { id_apartamento: idApartamento, ativo: 1 },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return ms.map((m) => contaMonitor(m.id));
  }

  /** Quem tocou nesta chamada: os moradores da unidade (chamada para a unidade). */
  private async tocadosDaChamada(c: ChamadaCarregada): Promise<number[]> {
    if (c.tipo === 'unidade_portaria' || !c.id_apartamento) return [];
    return this.moradoresDaUnidade(c.id_apartamento);
  }

  private async nomeDe(papel: (typeof PAPEIS_ATENDE)[number], uid: number): Promise<string | null> {
    try {
      if (papel === 'morador') return (await this.prisma.users.findUnique({ where: { id: uid }, select: { name: true } }))?.name ?? null;
      if (papel === 'portaria') {
        return (await this.prisma.funcionarios_Portaria.findUnique({ where: { id: uid }, select: { nome: true } }))?.nome ?? null;
      }
      return (await this.prisma.interfone_Monitores.findUnique({ where: { id: uid }, select: { nome: true } }))?.nome ?? null;
    } catch {
      return null;
    }
  }

  private unidadeDe(c: ChamadaCarregada): string {
    return c.apartamento ? rotuloAptoBloco(c.apartamento.apto, c.apartamento.bloco) : '';
  }

  private async fotoUrl(foto: string | null | undefined): Promise<string | null> {
    if (!foto) return null;
    try {
      return this.storage ? await this.storage.assinarUrl(foto) : foto;
    } catch {
      return null;
    }
  }

  /** Chamada com condomínio, unidade e facial. Público só para tipar `ChamadaCarregada`. */
  carregar(id: number) {
    if (!Number.isInteger(id) || id <= 0) return Promise.resolve(null);
    return this.prisma.interfone_Chamadas.findUnique({ where: { id }, include: INCLUDE_CHAMADA });
  }
}

type ChamadaCarregada = NonNullable<Awaited<ReturnType<InterfoneService['carregar']>>>;
