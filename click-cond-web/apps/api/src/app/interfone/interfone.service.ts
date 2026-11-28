import { agoraEmBrasilia, decidirDestino, DestinoPortaria, FaixaAgenda } from './destino-portaria';
import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { StorageService } from '../common/storage/storage.service';
import { executarComLock } from '../common/lock-distribuido';
import { rotuloAptoBloco } from '../visitantes/rotulo-apto-bloco.util';
import { normalizarFabricante } from '../facial/fabricantes';
import { InterfonePushService } from './interfone-push.service';
import { VozControleClient } from './voz-controle.client';
import { InterfoneFotoService } from './interfone-foto.service';
import { facialAtendeBloco, ramalValido } from './regras';

/** Anti-trote (Global Constraints do plano). */
export const LIMITE_POR_FACIAL_MIN = 6;
export const LIMITE_POR_UNIDADE_5MIN = 3;
const MIN_MS = 60_000;
/**
 * Rede de segurança: chamada não terminal mais velha que isto (contado da
 * criação) é dada como `falha` — o serviço de voz reiniciou e perdeu o
 * `encerrada`. Por estado: pior caso real (toque máximo de 60 s; + 120 s na
 * portaria; + 180 s de conversa) + 60 s de folga.
 */
export const ORFA_APOS_MS = { chamando: 3 * MIN_MS, portaria: 4 * MIN_MS, atendida: 7 * MIN_MS } as const;
/**
 * Ligação originada (portaria → unidade, unidade → portaria) não atendida em
 * toque + isto é dada como `falha`: a origem pode nunca conectar (microfone
 * negado, app fechado, JsSIP falhou) e ninguém encerraria.
 */
export const ORIGINADA_FOLGA_MS = 25_000;
const ORFAS_VERIFICA_MS = 15_000;
/** Reserva do "atender": vale para o estado em que foi feita. */
export const RESERVA_ATENDER_MS = 15_000;

/** Tempos de toque: [mínimo, máximo, padrão] em segundos. */
export const TOQUE_APTO_S = [15, 60, 30] as const;
export const TOQUE_PORTARIA_S = [15, 120, 45] as const;

export const RESULTADOS = [
  'atendida_morador',
  'atendida_portaria',
  'atendida_central',
  'nao_atendida',
  'recusada',
  'falha',
  'cancelada',
] as const;
export type ResultadoChamada = (typeof RESULTADOS)[number];
/** Quem pode "entrar" numa chamada pelo serviço de voz (o monitor IP e o operador da central também atendem). */
const PAPEIS_ATENDE = ['morador', 'portaria', 'monitor', 'central'] as const;

/** Por que a chamada do facial está na portaria (`portaria`: o visitante discou o número da portaria). */
export type MotivoPortaria = 'nao_atendeu' | 'recusou' | 'sem_app' | 'portaria';

/** Payload de `interfone:chamada` na sala `central` (o operador atende vários condomínios). */
export interface ChamadaCentralEvento {
  id: number;
  tipo: string;
  unidade: string;
  motivo: string | null;
  morador_nome: string | null;
  foto_url: string | null;
  id_condominio: number;
  condominio: string;
  portao: string | null;
  /** ISO 8601. */
  criada_em: string;
}

export type EventoServico =
  /** `nome`: o do token de voz (o serviço repassa); reserva para quando o banco não tem o nome. */
  | { evento: 'atendida'; papel: string; uid: number; nome?: string }
  | { evento: 'toque_esgotado' }
  | { evento: 'encerrada'; resultado: string; duracao_s: number };

export type NovaChamadaFacial =
  | {
      ok: true;
      id: number;
      tipo: 'facial_unidade' | 'facial_portaria';
      estado: 'chamando' | 'portaria';
      toque_s: number;
      monitores: string[];
    }
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
    select: {
      id: true,
      nome: true,
      interfone_transferir: true,
      interfone_toque_apto_s: true,
      interfone_toque_portaria_s: true,
      central_contratada: true,
      interfone_numero_portaria: true,
    },
  },
  apartamento: { select: { id: true, apto: true, bloco: true } },
  facial: { select: { id: true, nome: true, interfone_dtmf: true } },
} as const;

/** Rótulo da unidade da chamada ("Bloco A · Apto 106"); '' sem unidade. */
export function unidadeDaChamada(c: { apartamento?: { apto: string | null; bloco: string | null } | null }): string {
  return c.apartamento ? rotuloAptoBloco(c.apartamento.apto, c.apartamento.bloco) : '';
}

/** JSON array de ids inteiros (recusas, tocou_ids); null se vazio ou inválido. */
function lerIds(json: string | null | undefined): number[] | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((n) => Number.isInteger(n)) : null;
  } catch {
    return null;
  }
}

/** Conta SIP do facial na central (sem hífen: o Intelbras só aceita letras, números e '#'). */
export const contaFacial = (id: number) => `fac${id}`;
const contaMonitor = (id: number) => `mon${id}`;

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
  /** Trabalho disparado sem esperar (push, eventos do console, foto). */
  private readonly pendentes = new Set<Promise<unknown>>();
  /**
   * Reserva do "atender" (memória desta réplica): quem pediu primeiro fica com
   * a chamada por RESERVA_ATENDER_MS, só enquanto ela estiver no mesmo estado.
   */
  private readonly reservas = new Map<number, { chave: string; estado: string; ate: number }>();
  /** Erros de número inexistente por facial (contam para o limite por minuto). */
  private readonly erros = new Map<number, number[]>();
  /** Foto do visitante (InterfoneFotoService; público para os testes trocarem). */
  foto: CapturadorFotoInterfone | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: InterfonePushService,
    private readonly voz: VozControleClient,
    @Optional() private readonly realtime?: RealtimeGateway,
    @Optional() private readonly storage?: StorageService,
    @Optional() fotoService?: InterfoneFotoService,
  ) {
    this.foto = fotoService ?? null;
  }

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
   * Fecha como `falha` as chamadas em estado não terminal além do prazo do
   * estado (ORFA_APOS_MS), com o mesmo efeito do `encerrada` (push `fim`,
   * evento `interfone:fim`). Devolve quantas fechou. Nunca lança.
   */
  async fecharOrfas(): Promise<number> {
    let fechadas = 0;
    try {
      const agora = this.agora();
      const candidatas = await this.prisma.interfone_Chamadas.findMany({
        where: {
          OR: [
            ...(Object.keys(ORFA_APOS_MS) as (keyof typeof ORFA_APOS_MS)[]).map((estado) => ({
              estado,
              created_at: { lt: new Date(agora - ORFA_APOS_MS[estado]) },
            })),
            // Originadas ainda tocando: o prazo depende do toque do condomínio (filtro abaixo).
            {
              tipo: { in: ['portaria_unidade', 'unidade_portaria'] },
              estado: { in: ['chamando', 'portaria'] },
              created_at: { lt: new Date(agora - TOQUE_APTO_S[0] * 1000 - ORIGINADA_FOLGA_MS) },
            },
          ],
        },
        include: INCLUDE_CHAMADA,
        orderBy: { id: 'asc' },
        take: 200,
      });
      const orfas = candidatas.filter((c) => {
        const idade = agora - c.created_at.getTime();
        const geral = (ORFA_APOS_MS as Record<string, number>)[c.estado];
        if (geral !== undefined && idade > geral) return true;
        if (c.tipo === 'portaria_unidade' && c.estado === 'chamando') {
          return idade > limitar(c.condominio?.interfone_toque_apto_s, TOQUE_APTO_S) * 1000 + ORIGINADA_FOLGA_MS;
        }
        if (c.tipo === 'unidade_portaria' && c.estado === 'portaria') {
          return idade > limitar(c.condominio?.interfone_toque_portaria_s, TOQUE_PORTARIA_S) * 1000 + ORIGINADA_FOLGA_MS;
        }
        return false;
      });
      for (const c of orfas) {
        try {
          // Condicional ao estado lido: atendida entre a leitura e a escrita não é sobrescrita.
          if (await this.fecharComo(c, 'falha', null, true)) {
            fechadas++;
            // Originada fechada pelo relógio: o serviço pode ainda ter a origem tocando.
            if (c.tipo === 'portaria_unidade' || c.tipo === 'unidade_portaria') {
              this.emSegundoPlano(`encerrar ligação ${c.id} no serviço`, () => this.voz.encerrar(c.id));
            }
          }
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

  /**
   * Roda `fn` em segundo plano: quem chamou (o serviço de voz desiste em 5 s)
   * não espera push nem evento do console. Erros só vão para o log.
   */
  emSegundoPlano(rotulo: string, fn: () => Promise<unknown>): void {
    const p: Promise<unknown> = Promise.resolve()
      .then(fn)
      .catch((e: any) => this.logger.warn(`Interfone: ${rotulo} falhou: ${e?.message ?? e}`))
      .finally(() => this.pendentes.delete(p));
    this.pendentes.add(p);
  }

  /** Para os testes: espera tudo o que foi disparado em segundo plano. */
  async ociosos(): Promise<void> {
    while (this.pendentes.size) await Promise.all([...this.pendentes]);
  }

  /**
   * Reserva a chamada para `chave` (ex.: `morador:7`) no estado atual. Devolve
   * false se outra pessoa já reservou neste mesmo estado e a reserva vale.
   */
  reservar(id: number, chave: string, estado: string, agora: number): boolean {
    const r = this.reservas.get(id);
    if (r && r.ate > agora && r.estado === estado && r.chave !== chave) return false;
    this.reservas.set(id, { chave, estado, ate: agora + RESERVA_ATENDER_MS });
    if (this.reservas.size > 500) {
      for (const [k, v] of this.reservas) if (v.ate <= agora) this.reservas.delete(k);
    }
    return true;
  }

  /** Quem segura a reserva valendo neste estado (ex.: `central:5`), ou null. */
  donoDaReserva(id: number, estado: string, agora: number): string | null {
    const r = this.reservas.get(id);
    return r && r.ate > agora && r.estado === estado ? r.chave : null;
  }

  /** Libera a reserva (de qualquer um, ou só se for de `chave`). */
  liberarReserva(id: number, chave?: string): void {
    const r = this.reservas.get(id);
    if (r && (!chave || r.chave === chave)) this.reservas.delete(id);
  }

  private errosRecentes(idFacial: number, agora: number): number {
    const l = (this.erros.get(idFacial) ?? []).filter((t) => t > agora - MIN_MS);
    if (l.length) this.erros.set(idFacial, l);
    else this.erros.delete(idFacial);
    return l.length;
  }

  /** Tentativa sem chamada (número inexistente, portaria sem ninguém): conta para o limite por facial. */
  private tentativaPerdida(idFacial: number, agora: number, motivo: 'nao_encontrado' | 'indisponivel'): NovaChamadaFacial {
    const l = this.erros.get(idFacial) ?? [];
    l.push(agora);
    this.erros.set(idFacial, l);
    if (this.erros.size > 5000) this.erros.clear();
    return { ok: false, motivo };
  }

  private naoEncontrado(idFacial: number, agora: number): NovaChamadaFacial {
    return this.tentativaPerdida(idFacial, agora, 'nao_encontrado');
  }

  // ─────────────────────────────────────────── chamada do facial

  async novaChamadaFacial(conta: string, numero: string): Promise<NovaChamadaFacial> {
    const m = /^fac-?(\d{1,10})$/.exec(String(conta ?? ''));
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
            central_contratada: true,
            interfone_numero_portaria: true,
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

    const agora = this.agora();
    // Limite por facial: chamadas criadas + números inexistentes (memória
    // desta réplica) no último minuto — varrer ramais também é trote.
    const doFacial = await this.prisma.interfone_Chamadas.count({
      where: { id_facial: facial.id, created_at: { gte: new Date(agora - MIN_MS) } },
    });
    if (doFacial + this.errosRecentes(facial.id, agora) >= LIMITE_POR_FACIAL_MIN) return { ok: false, motivo: 'limite' };

    const num = String(numero ?? '').trim();
    // "0 = portaria": só com central contratada (sem ela, o número segue o
    // caminho do ramal exatamente como antes). Vem antes do ramal.
    const numPortaria = String(cond.interfone_numero_portaria ?? '').trim();
    if (cond.central_contratada === 1 && numPortaria && num === numPortaria) {
      return this.chamadaParaPortaria(facial, cond, num, agora);
    }
    if (!ramalValido(num)) return this.naoEncontrado(facial.id, agora);

    const apto = await this.prisma.apartamentos.findFirst({
      where: { id_condominio: facial.id_condominio, interfone_ramal: num },
      select: { id: true, apto: true, bloco: true },
    });
    if (!apto || !facialAtendeBloco(facial.interfone_blocos, apto.bloco)) return this.naoEncontrado(facial.id, agora);

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
    const foto = this.foto;
    if (foto) this.emSegundoPlano(`foto da chamada ${chamada.id}`, () => foto.capturar(chamada.id, facial));

    // Monitores entram na resposta (o serviço liga para eles); o toque dos
    // celulares vai em segundo plano: o APNs pode levar segundos e o serviço
    // desiste em 5 s.
    const monitores = await this.monitoresDaUnidade(apto.id);
    const unidade = rotuloAptoBloco(apto.apto, apto.bloco);
    this.emSegundoPlano(`toque da chamada ${chamada.id}`, async () => {
      const moradores = await this.moradoresDaUnidade(apto.id);
      const r = await this.push.tocar(chamada.id, moradores, {
        tipo: 'facial_unidade',
        unidade,
        portao: facial.nome,
        condominio: cond.nome,
      });
      await this.gravarTocou(chamada.id, r.ids);
      // Recusas que chegaram antes de saber quem tocou.
      await this.avaliarRecusas(chamada.id);
      // Nenhum celular tocou (sem app novo, push falhou, ninguém com vínculo)
      // e não há monitor na unidade: vai direto para a portaria, se houver.
      if (r.tocou === 0 && monitores.length === 0) {
        await this.prisma.interfone_Chamadas.updateMany({
          where: { id: chamada.id, motivo_portaria: null },
          data: { motivo_portaria: 'sem_app' },
        });
        await this.transferirSemApp(chamada.id);
      }
    });

    return {
      ok: true,
      id: chamada.id,
      tipo: 'facial_unidade',
      estado: 'chamando',
      toque_s: limitar(cond.interfone_toque_apto_s, TOQUE_APTO_S),
      monitores,
    };
  }

  /**
   * O visitante discou o número da portaria (só em condomínio com central
   * contratada): a chamada nasce em `portaria`,
   * sem unidade e sem tocar morador. Destino `local` exige porteiro no
   * console; `central`, porteiro ou operador conectado. Ninguém → indisponível
   * (o facial ouve a mensagem e desliga).
   */
  private async chamadaParaPortaria(
    facial: { id: number; id_condominio: number; [k: string]: unknown },
    cond: { central_contratada?: number | null },
    num: string,
    agora: number,
  ): Promise<NovaChamadaFacial> {
    const idCondominio = facial.id_condominio;
    const d = await this.destinoDoCondominio(idCondominio, cond.central_contratada);
    const destino = d.destino;
    const porteiro = d.porteiro ?? (await this.porteirosOnline(idCondominio));
    if (!porteiro && (destino === 'local' || !(await this.centralOnline()))) {
      if (destino === 'central') this.registrarSemOperador(idCondominio, null);
      // Rediscar a portaria sem ninguém também é trote: conta para o limite por facial.
      return this.tentativaPerdida(facial.id, agora, 'indisponivel');
    }

    const chamada = await this.prisma.interfone_Chamadas.create({
      data: {
        id_condominio: idCondominio,
        tipo: 'facial_portaria',
        estado: 'portaria',
        id_facial: facial.id,
        numero_discado: num,
        motivo_portaria: 'portaria',
        created_at: new Date(agora),
      },
    });

    // Foto e aviso ao console/central sem esperar: o serviço desiste em 5 s.
    const foto = this.foto;
    if (foto) this.emSegundoPlano(`foto da chamada ${chamada.id}`, () => foto.capturar(chamada.id, facial));
    this.emSegundoPlano(`aviso da chamada ${chamada.id} na portaria`, async () => {
      const c = await this.carregar(chamada.id);
      if (c) await this.emitirEncaminhada(c, 'portaria', destino, porteiro);
    });

    return { ok: true, id: chamada.id, tipo: 'facial_portaria', estado: 'portaria', toque_s: 0, monitores: [] };
  }

  /**
   * Sem ninguém para tocar na unidade: leva para a portaria pelo destino do
   * condomínio (encaminharSemResposta) e pede ao serviço para tocar lá (em
   * segundo plano: o serviço ainda não recebeu o id). Sem para onde levar,
   * deixa tocar — o toque esgota e o serviço encerra com "ninguém atendeu"
   * (o "sem operador" da central é registrado nessa hora, uma vez só).
   */
  private async transferirSemApp(id: number) {
    const c = await this.carregar(id);
    if (!c || c.estado !== 'chamando' || c.tipo !== 'facial_unidade') return;
    const motivo = (c.motivo_portaria as MotivoPortaria | null) ?? 'sem_app';
    if ((await this.encaminharSemResposta(c, motivo, { registrarSemOperador: false })) !== 'portaria') return;
    for (const ms of this.esperasPortariaMs) {
      await this.dormir(ms);
      if (await this.voz.portaria(id)) return;
    }
    this.logger.warn(`Interfone: serviço de voz não aceitou levar a chamada ${id} para a portaria.`);
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

  private async atendida(c: ChamadaCarregada, ev: { papel: string; uid: number; nome?: unknown }): Promise<{ ok: true }> {
    const papel = ev?.papel;
    const uid = Number(ev?.uid);
    if (!(PAPEIS_ATENDE as readonly string[]).includes(papel) || !Number.isInteger(uid) || uid <= 0) {
      throw new BadRequestException('Quem atendeu é inválido.');
    }
    // Banco primeiro (Users.name → cadastro de morador; Funcionarios_Portaria.nome; Central_Operadores.nome); sem ele, o nome do token.
    const nome = (await this.nomeDe(papel as (typeof PAPEIS_ATENDE)[number], uid, c.id_condominio)) ?? textoNome(ev?.nome);
    // Condicional: o primeiro que entra ganha; o segundo evento não sobrescreve.
    const r = await this.prisma.interfone_Chamadas.updateMany({
      where: { id: c.id, atendida_em: null, estado: { in: ['chamando', 'portaria'] } },
      data: {
        estado: 'atendida',
        atendida_em: new Date(this.agora()),
        atendida_por_tipo: papel,
        atendida_por_id: uid,
        atendida_por_nome: nome,
        // Operador da central que atendeu; outro papel limpa o que o "atender" do operador gravou
        // (menos na ligação que o operador fez para a unidade: ali ele é quem ligou).
        ...(papel === 'central' ? { id_operador_central: uid } : c.tipo === 'portaria_unidade' ? {} : { id_operador_central: null }),
      },
    });
    if (r.count === 0) return { ok: true };
    this.emitirFim(c);
    this.emSegundoPlano(`fim (atendida) da chamada ${c.id}`, async () => {
      const tocados = await this.tocadosDaChamada(c);
      await this.push.fim(
        c.id,
        tocados.filter((u) => !(papel === 'morador' && u === uid)),
      );
    });
    return { ok: true };
  }

  private async toqueEsgotado(c: ChamadaCarregada): Promise<{ proximo: 'portaria' | 'encerrar' }> {
    // Só o toque da unidade chamada pelo facial transfere (a portaria que liga
    // para a unidade não transfere para si mesma).
    // Já levada à portaria (recusa de todos ou sem app) e o /portaria do
    // controle se perdeu: segue na portaria.
    if (c.estado === 'portaria' && c.tipo === 'facial_unidade') return { proximo: 'portaria' };
    if (c.estado !== 'chamando' || c.tipo !== 'facial_unidade') return { proximo: 'encerrar' };
    const motivo = (c.motivo_portaria as MotivoPortaria | null) ?? 'nao_atendeu';
    // Responde já ao serviço; o console (e a central) toca em segundo plano.
    const proximo = await this.encaminharSemResposta(c, motivo, { emitirEmSegundoPlano: true });
    if (proximo === 'portaria') {
      // Os celulares param: na portaria o morador não atende mais.
      this.emSegundoPlano(`fim do toque da chamada ${c.id}`, async () => this.push.fim(c.id, await this.tocadosDaChamada(c)));
    }
    return { proximo };
  }

  /**
   * A unidade não atendeu (toque esgotado, todos recusaram, ninguém para
   * tocar): leva a chamada para a portaria conforme o destino do condomínio.
   * - `local`: há porteiro no console e o síndico ligou "transferir" (com
   *   central contratada, transferir é sempre ligado: incluído no contrato).
   * - `central`: transfere sempre; toca no console do
   *   prédio se houver porteiro e sempre na sala `central`. Sem porteiro nem
   *   operador → `encerrar` e registra `sem_operador` (log + métrica).
   * Grava `portaria` + motivo só se a chamada ainda está `chamando`.
   */
  private async encaminharSemResposta(
    c: ChamadaCarregada,
    motivo: MotivoPortaria,
    opcoes: { registrarSemOperador?: boolean; emitirEmSegundoPlano?: boolean } = {},
  ): Promise<'portaria' | 'encerrar'> {
    const comCentral = c.condominio?.central_contratada === 1;
    const d = await this.destinoDoCondominio(c.id_condominio, c.condominio?.central_contratada);
    const destino = d.destino;
    let porteiro: boolean;
    if (destino === 'local') {
      if (!comCentral && c.condominio?.interfone_transferir !== 1) return 'encerrar';
      porteiro = d.porteiro ?? (await this.porteirosOnline(c.id_condominio));
      if (!porteiro) return 'encerrar';
    } else {
      porteiro = d.porteiro ?? (await this.porteirosOnline(c.id_condominio));
      if (!porteiro && !(await this.centralOnline())) {
        if (opcoes.registrarSemOperador !== false) this.registrarSemOperador(c.id_condominio, c.id);
        return 'encerrar';
      }
    }
    const r = await this.prisma.interfone_Chamadas.updateMany({
      where: { id: c.id, estado: 'chamando' },
      data: { estado: 'portaria', motivo_portaria: motivo },
    });
    if (r.count === 0) return 'encerrar';
    this.liberarReserva(c.id);
    const emitir = () => this.emitirEncaminhada(c, motivo, destino, porteiro);
    if (opcoes.emitirEmSegundoPlano) this.emSegundoPlano(`aviso da chamada ${c.id} na portaria`, emitir);
    else await emitir();
    return 'portaria';
  }

  /**
   * Avisa quem atende: console do prédio (destino local, ou central com
   * porteiro conectado) e, no destino central, a sala `central`.
   */
  private async emitirEncaminhada(c: ChamadaCarregada, motivo: MotivoPortaria, destino: DestinoPortaria, porteiro: boolean): Promise<void> {
    const base = {
      id: c.id,
      tipo: c.tipo,
      unidade: unidadeDaChamada(c),
      motivo,
      morador_nome: null,
      foto_url: await this.fotoUrl(c.foto),
    };
    if (destino === 'local' || porteiro) this.emitirParaPortaria(c.id_condominio, base);
    if (destino === 'central') {
      const evento: ChamadaCentralEvento = {
        ...base,
        id_condominio: c.id_condominio,
        condominio: c.condominio?.nome ?? '',
        portao: c.facial?.nome ?? null,
        criada_em: c.created_at.toISOString(),
      };
      this.realtime?.emitirCentral('interfone:chamada', evento);
    }
  }

  /** `interfone:fim` no console e, em condomínio da central, na sala central (a fila do operador tira a chamada). */
  private emitirFim(c: ChamadaCarregada): void {
    this.realtime?.emitirPortaria(c.id_condominio, 'interfone:fim', { id: c.id });
    if (c.condominio?.central_contratada === 1) this.realtime?.emitirCentral('interfone:fim', { id: c.id });
  }

  /** Central contratada sem ninguém para atender: log + métrica EMF `CentralSemOperador` (CloudWatch). */
  private registrarSemOperador(idCondominio: number, idChamada: number | null): void {
    this.logger.warn(`[central] sem_operador condominio=${idCondominio} chamada=${idChamada ?? '-'}`);
    console.log(
      JSON.stringify({
        _aws: {
          Timestamp: this.agora(),
          CloudWatchMetrics: [{ Namespace: 'Prestare/Interfone', Dimensions: [[]], Metrics: [{ Name: 'CentralSemOperador', Unit: 'Count' }] }],
        },
        CentralSemOperador: 1,
        condominio: idCondominio,
        chamada: idChamada,
      }),
    );
  }

  /** `interfone:chamada` para os porteiros do condomínio (chamada do facial transferida). */
  async emitirChamadaPortaria(c: ChamadaCarregada, motivo: MotivoPortaria | string): Promise<void> {
    this.emitirParaPortaria(c.id_condominio, {
      id: c.id,
      tipo: c.tipo,
      unidade: unidadeDaChamada(c),
      motivo,
      morador_nome: null,
      foto_url: await this.fotoUrl(c.foto),
    });
  }

  /** Payload do contrato de `interfone:chamada`. */
  emitirParaPortaria(
    idCondominio: number,
    dados: { id: number; tipo: string; unidade: string; motivo: string | null; morador_nome: string | null; foto_url: string | null },
  ) {
    this.realtime?.emitirPortaria(idCondominio, 'interfone:chamada', dados);
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
  /**
   * Encerra (uma vez só) e para tudo. Público para as ações (ex.: todos
   * recusaram sem portaria → `recusada` gravada antes de o serviço mandar o
   * `encerrada`, que então é descartado pela idempotência).
   */
  async encerrarComo(c: ChamadaCarregada, resultado: ResultadoChamada, duracao: number | null = null): Promise<boolean> {
    return this.fecharComo(c, resultado, duracao, true);
  }

  /**
   * `condicional`: só grava se a chamada ainda está no estado lido (rotina de
   * órfãs, ações). O `encerrada` do serviço de voz é a palavra final e grava
   * em qualquer estado não terminal.
   */
  private async fecharComo(c: ChamadaCarregada, resultado: ResultadoChamada, duracao: number | null, condicional = false): Promise<boolean> {
    const r = await this.prisma.interfone_Chamadas.updateMany({
      where: { id: c.id, estado: condicional && c.estado !== 'encerrada' ? c.estado : { not: 'encerrada' } },
      data: { estado: 'encerrada', resultado, duracao_s: duracao, encerrada_em: new Date(this.agora()) },
    });
    if (r.count === 0) return false;
    this.liberarReserva(c.id);
    this.emitirFim(c);
    this.emSegundoPlano(`fim da chamada ${c.id}`, async () => {
      const tocados = await this.tocadosDaChamada(c);
      await this.push.fim(c.id, tocados);
      if (resultado === 'nao_atendida' && c.tipo === 'facial_unidade') {
        await this.push.perdida(c.id, tocados, horaBrasiliaHHMM(c.created_at));
      }
    });
    return true;
  }

  // ─────────────────────────────────────────── consultas do serviço

  async dadosParaServico(id: number) {
    const c = await this.carregar(id);
    if (!c) throw new NotFoundException('Chamada não encontrada.');
    // Monitor IP toca quando alguém chama a unidade (facial ou portaria).
    const comMonitor = c.tipo !== 'unidade_portaria' && c.id_apartamento;
    return {
      id: c.id,
      tipo: c.tipo,
      estado: c.estado,
      // facial_portaria nasce na portaria: não toca a unidade.
      toque_s: c.tipo === 'facial_portaria' ? 0 : limitar(c.condominio?.interfone_toque_apto_s, TOQUE_APTO_S),
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

  /**
   * Estado de registro das contas na central (a cada 60 s, a lista inteira).
   * Só os faciais guardam (o console mostra). Em lote: registrados passam a 1
   * (com a hora da passagem), os demais da lista a 0, e facial que saiu da
   * lista (desabilitado, módulo desligado) também volta a 0.
   */
  async registros(contas: { conta: string; registrado: boolean }[]): Promise<{ ok: true; atualizados: number }> {
    if (!Array.isArray(contas)) throw new BadRequestException('contas deve ser uma lista.');
    const sim = new Set<number>();
    const nao = new Set<number>();
    for (const item of contas.slice(0, 5000)) {
      const m = /^fac-?(\d{1,10})$/.exec(String(item?.conta ?? ''));
      if (!m) continue;
      (item.registrado === true ? sim : nao).add(Number(m[1]));
    }
    for (const id of sim) nao.delete(id);
    const agora = new Date(this.agora());
    const [a, b, c] = await Promise.all([
      sim.size
        ? this.prisma.facial_Devices.updateMany({
            where: { id: { in: [...sim] }, interfone_registrado: 0 },
            data: { interfone_registrado: 1, interfone_registrado_em: agora },
          })
        : { count: 0 },
      nao.size
        ? this.prisma.facial_Devices.updateMany({ where: { id: { in: [...nao] }, interfone_registrado: 1 }, data: { interfone_registrado: 0 } })
        : { count: 0 },
      this.prisma.facial_Devices.updateMany({
        where: { interfone_registrado: 1, id: { notIn: [...sim, ...nao] } },
        data: { interfone_registrado: 0 },
      }),
    ]);
    return { ok: true, atualizados: a.count + b.count + c.count };
  }

  // ─────────────────────────────────────────── apoio

  /** Há porteiro com o console aberto? Sem gateway (testes, boot) = não. */
  async porteirosOnline(idCondominio: number): Promise<boolean> {
    return (await this.realtime?.porteirosOnline(idCondominio)) ?? false;
  }

  /** Há operador da central conectado? Sem gateway = não. */
  async centralOnline(): Promise<boolean> {
    return (await this.realtime?.centralOnline()) ?? false;
  }

  /**
   * Destino sem consulta extra para quem não contratou a central (o caso de
   * hoje; `porteiro: null` = não consultado). Com central, o porteiro online
   * é consultado uma vez e devolvido junto. Agenda ilegível em condomínio da
   * central → `central`: toca na central e, se houver porteiro, também no prédio.
   */
  private async destinoDoCondominio(
    idCondominio: number,
    centralContratada: number | null | undefined,
  ): Promise<{ destino: DestinoPortaria; porteiro: boolean | null }> {
    if (centralContratada !== 1) return { destino: 'local', porteiro: null };
    const porteiro = await this.porteirosOnline(idCondominio);
    try {
      return { destino: await this.destinoPortaria(idCondominio, new Date(this.agora()), porteiro), porteiro };
    } catch (e) {
      this.logger.warn(`Interfone: destino da portaria do condomínio ${idCondominio} não veio do banco: ${(e as Error)?.message ?? e}`);
      return { destino: 'central', porteiro };
    }
  }

  /**
   * Para onde vai a chamada da portaria agora: porteiro local ou central
   * (agenda + salvaguarda). `porteiroOnline`: já consultado por quem chama.
   */
  async destinoPortaria(idCondominio: number, agora = new Date(), porteiroOnline?: boolean): Promise<DestinoPortaria> {
    const cond = await this.prisma.condominios.findUnique({ where: { id: idCondominio }, select: { central_contratada: true } });
    if (!cond?.central_contratada) return 'local';
    const momento = agoraEmBrasilia(agora);
    const faixas = await this.prisma.portaria_Agenda.findMany({
      where: { id_condominio: idCondominio, dia_semana: momento.diaSemana },
      select: { dia_semana: true, inicio: true, fim: true, destino: true },
    });
    return decidirDestino(true, faixas as FaixaAgenda[], momento, porteiroOnline ?? (await this.porteirosOnline(idCondominio)));
  }

  /**
   * Moradores vinculados à unidade: basta existir a linha em Apartamentos_Users. O vencimento não conta — no resto
   * do sistema é só exibição ("dias restantes") e todo vínculo feito pelo app nasce com hoje + 45 dias.
   */
  async moradoresDaUnidade(idApartamento: number): Promise<number[]> {
    const usuarios = await this.prisma.users.findMany({
      where: { apartamentosUsers: { some: { id_apto: idApartamento } } },
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

  /**
   * Todos em que o toque SAIU recusaram? Então a chamada do facial segue o
   * destino da portaria como "não atendeu" (`recusou`, encaminharSemResposta);
   * sem para onde levar (ou ligação da portaria), grava `recusada` e só
   * então pede ao serviço para encerrar (o `encerrada nao_atendida` que ele
   * manda depois é descartado: sem "Chamada perdida" para quem recusou).
   * Unidade com monitor ativo não entra: o toque segue e a transferência
   * acontece no toque esgotado.
   */
  async avaliarRecusas(id: number): Promise<void> {
    const c = await this.carregar(id);
    if (!c || c.estado !== 'chamando' || (c.tipo !== 'facial_unidade' && c.tipo !== 'portaria_unidade')) return;
    const recusas = lerIds(c.recusas) ?? [];
    const tocaram = lerIds(c.tocou_ids) ?? [];
    if (!recusas.length || !tocaram.length || !tocaram.every((u) => recusas.includes(u))) return;
    if (c.id_apartamento && (await this.prisma.interfone_Monitores.count({ where: { id_apartamento: c.id_apartamento, ativo: 1 } })) > 0) {
      return;
    }
    const proximo = c.tipo === 'facial_unidade' ? await this.encaminharSemResposta(c, 'recusou') : 'encerrar';
    if (proximo === 'portaria') {
      await this.voz.portaria(c.id);
      return;
    }
    // Condicional ao estado lido: chamada que mudou entretanto (atendida, já na portaria) não é encerrada.
    if (await this.encerrarComo(c, 'recusada')) await this.voz.encerrar(c.id);
  }

  /** Grava em `tocou_ids` os usuários em que o toque saiu. */
  async gravarTocou(id: number, ids: number[]): Promise<void> {
    await this.prisma.interfone_Chamadas.updateMany({ where: { id }, data: { tocou_ids: JSON.stringify(ids ?? []) } });
  }

  /** Users.id em que o toque saiu (`tocou_ids`), ou null se ainda não gravado. */
  tocouDaChamada(c: { tocou_ids?: string | null }): number[] | null {
    return lerIds(c.tocou_ids);
  }

  /** Quem tocou nesta chamada: os moradores da unidade (chamada para a unidade). */
  private async tocadosDaChamada(c: ChamadaCarregada): Promise<number[]> {
    if (c.tipo === 'unidade_portaria' || !c.id_apartamento) return [];
    return this.moradoresDaUnidade(c.id_apartamento);
  }

  /** Nome de quem atendeu pelo banco, ou null (sem cadastro, nome em branco ou banco falhando). */
  private async nomeDe(papel: (typeof PAPEIS_ATENDE)[number], uid: number, idCondominio: number): Promise<string | null> {
    try {
      if (papel === 'morador') {
        const u = await this.prisma.users.findUnique({ where: { id: uid }, select: { name: true } });
        const doUsuario = textoNome(u?.name);
        if (doUsuario) return doUsuario;
        // Users.name pode estar vazio: o nome do morador também fica no cadastro dele no condomínio.
        const m = await this.prisma.moradores.findFirst({
          where: { id_user: uid, id_condominio: idCondominio },
          orderBy: { id: 'desc' },
          select: { nome: true },
        });
        return textoNome(m?.nome);
      }
      if (papel === 'portaria') {
        return textoNome((await this.prisma.funcionarios_Portaria.findUnique({ where: { id: uid }, select: { nome: true } }))?.nome);
      }
      if (papel === 'central') {
        return textoNome((await this.prisma.central_Operadores.findUnique({ where: { id: uid }, select: { nome: true } }))?.nome);
      }
      return textoNome((await this.prisma.interfone_Monitores.findUnique({ where: { id: uid }, select: { nome: true } }))?.nome);
    } catch (e) {
      this.logger.warn(`Interfone: nome de quem atendeu (${papel} ${uid}) não veio do banco: ${(e as Error)?.message ?? e}`);
      return null;
    }
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

/** Nome limpo e cortado em 120, ou null se não for texto ou estiver em branco. */
function textoNome(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, 120) : null;
}
