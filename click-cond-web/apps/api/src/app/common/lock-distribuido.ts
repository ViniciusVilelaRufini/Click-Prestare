import { Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { EstadoCompartilhado } from './estado-compartilhado';

/**
 * Lock distribuído com GET_LOCK do MySQL, para a API rodar em mais de uma
 * instância (Elastic Beanstalk com 2 instâncias atrás do ALB).
 *
 * Por que GET_LOCK: o lock nomeado vive na SESSÃO do MySQL — some sozinho se a
 * conexão cair (instância morreu no meio do job) e não precisa de tabela nem
 * de faxina. A pegadinha é o pool do Prisma: GET_LOCK e RELEASE_LOCK precisam
 * sair pela MESMA conexão, senão o RELEASE vai para outra sessão e o lock fica
 * preso numa conexão do pool. Por isso os dois rodam dentro de uma transação
 * interativa, que segura uma única conexão do começo ao fim.
 *
 * Custo: cada job em andamento ocupa UMA conexão do pool (connection_limit=25
 * em produção) pelo tempo do job. O trabalho do job em si usa o client normal
 * (outras conexões) — a transação só guarda o lock, não envolve as queries do
 * job, então nada fica preso em snapshot ou rollback.
 *
 * Sem banco (modo offline / testes com Prisma falso sem $transaction) a função
 * roda direto: é o comportamento de uma instância só, igual a antes.
 */

const PREFIXO = 'prestare:';
/** Limite do MySQL para nome de GET_LOCK. */
const MAX_NOME = 64;
/** Prazo padrão de um job segurando o lock antes de o lock ser devolvido à força. */
const DURACAO_MAXIMA_PADRAO_MS = 60 * 60 * 1000;

const logger = new Logger('LockDistribuido');

export interface OpcoesLock {
  /**
   * Quanto esperar pelo lock (GET_LOCK timeout, em segundos). 0 (padrão) =
   * não espera: se outra instância está com ele, devolve na hora.
   */
  esperaSegundos?: number;
  /**
   * Prazo de quem está com o lock. Passou disso, o lock é liberado (o job
   * continua rodando, mas sem exclusividade) — senão a transação interativa
   * estouraria o timeout do Prisma, a conexão voltaria ao pool AINDA com o
   * lock e nenhuma instância conseguiria rodar o job até reiniciar.
   */
  duracaoMaximaMs?: number;
  /**
   * Só para `executarComLock`: período do job. Cada instância tem os próprios
   * timers (desalinhados), então o lock sozinho evita SOBREPOSIÇÃO mas não
   * evita as duas rodarem no mesmo período. Com isto, o INÍCIO da última
   * execução bem-sucedida fica em estado_compartilhado e quem chegar antes de
   * 90% do período pula. Marcar o início (e não o fim) impede que um job que
   * dura mais de 10% do período "escorregue" para rodar a cada 2 períodos.
   *
   * NÃO use em job com porta de calendário (dia 1, hora 9...): um tick que não
   * passou da porta marcaria o período e bloquearia o tick que passaria. Para
   * esses, use `cicloDeNegocio`.
   */
  intervaloMinimoMs?: number;
  /**
   * Só para `executarComLock`: chave de negócio do ciclo (ex.: '2026-11' para
   * faturas do mês, '2026-11-04' para os lembretes do dia), ou null se a porta
   * de calendário ainda não abriu (aí o job nem roda, e nada é marcado).
   * Roda no máximo uma vez por chave no cluster: a marca só é gravada depois
   * de uma execução bem-sucedida, então restart ou rolling deploy no meio do
   * ciclo não pulam nem duplicam o ciclo.
   */
  cicloDeNegocio?: () => string | null;
  /** Validade da marca do ciclo (padrão 40 dias). */
  cicloTtlMs?: number;
}

/**
 * Lançado por `comLock` quando `fn` passa de `duracaoMaximaMs`: o lock foi
 * liberado e `fn` segue rodando sem exclusividade — não há valor para devolver.
 */
export class PrazoDoLockEstouradoError extends Error {
  constructor(readonly nomeDoLock: string, readonly prazoMs: number) {
    super(`Lock "${nomeDoLock}" liberado depois de ${Math.round(prazoMs / 1000)}s: a execução segue sem exclusividade`);
    this.name = 'PrazoDoLockEstouradoError';
  }
}

const PRAZO_ESTOURADO = Symbol('prazo-estourado');

/**
 * Um EstadoCompartilhado por PrismaService (por processo): sem banco, o
 * fallback em memória precisa sobreviver entre os ticks — senão a marca do
 * ciclo/período se perderia a cada chamada.
 */
const estadosPorPrisma = new WeakMap<object, EstadoCompartilhado>();
let estadoSemPrisma: EstadoCompartilhado | undefined;
function estadoDosJobs(prisma: PrismaParaLock | null | undefined): EstadoCompartilhado {
  if (!prisma) return (estadoSemPrisma ??= new EstadoCompartilhado(null));
  let e = estadosPorPrisma.get(prisma);
  if (!e) {
    e = new EstadoCompartilhado(prisma as any);
    estadosPorPrisma.set(prisma, e);
  }
  return e;
}

/** O mínimo do PrismaService que o lock usa (facilita mock nos testes). */
export interface PrismaParaLock {
  isConnected?: boolean;
  $transaction?: (...args: any[]) => Promise<any>;
}

export type ResultadoLock<T> = { obtido: true; valor: T } | { obtido: false };

/** Nome efetivo no MySQL: prefixado e cortado (com hash) a 64 caracteres. */
export function nomeDoLockMysql(nome: string): string {
  const completo = PREFIXO + nome;
  if (completo.length <= MAX_NOME) return completo;
  return PREFIXO + createHash('sha1').update(nome).digest('hex');
}

function semBanco(prisma: PrismaParaLock | null | undefined): boolean {
  return !prisma || prisma.isConnected === false || typeof prisma.$transaction !== 'function';
}

/**
 * Roda `fn` com o lock `nome`. Devolve `{ obtido: false }` se outra instância
 * estiver com ele (depois de esperar `esperaSegundos`). Erro de `fn` é
 * propagado (depois de liberar o lock). Erro do próprio banco ao pegar o lock
 * também é propagado — quem quer "nunca rejeitar" usa `executarComLock`.
 * Se `fn` passar de `duracaoMaximaMs`, o lock é liberado e a chamada REJEITA
 * com `PrazoDoLockEstouradoError` (nunca `{ obtido: true, valor: undefined }`).
 */
export async function comLock<T>(
  prisma: PrismaParaLock | null | undefined,
  nome: string,
  fn: () => Promise<T>,
  opcoes: OpcoesLock = {},
): Promise<ResultadoLock<T>> {
  if (semBanco(prisma)) return { obtido: true, valor: await fn() };

  const chave = nomeDoLockMysql(nome);
  const espera = Math.max(0, Math.floor(opcoes.esperaSegundos ?? 0));
  const duracaoMaxima = opcoes.duracaoMaximaMs ?? DURACAO_MAXIMA_PADRAO_MS;
  let resultado: ResultadoLock<T> = { obtido: false };
  let estourou = false;

  await prisma!.$transaction!(
    async (tx: any) => {
      const linhas: Array<{ ok: unknown }> = await tx.$queryRaw`SELECT GET_LOCK(${chave}, ${espera}) AS ok`;
      // 1 = pegou; 0 = ocupado (timeout); NULL = erro. BigInt no driver MySQL.
      if (Number(linhas?.[0]?.ok) !== 1) return;
      try {
        const v = await comPrazo(fn(), duracaoMaxima, nome);
        if (v === PRAZO_ESTOURADO) estourou = true;
        else resultado = { obtido: true, valor: v as T };
      } finally {
        try {
          await tx.$queryRaw`SELECT RELEASE_LOCK(${chave}) AS ok`;
        } catch (err: any) {
          logger.error(`Falha ao liberar o lock "${nome}": ${err?.message ?? err}`);
        }
      }
    },
    // maxWait: quanto esperar por uma conexão livre no pool. timeout: folga
    // além da espera do GET_LOCK e do prazo do job.
    { maxWait: 10_000, timeout: espera * 1000 + duracaoMaxima + 30_000 },
  );
  if (estourou) throw new PrazoDoLockEstouradoError(nome, duracaoMaxima);
  return resultado;
}

/**
 * Para jobs agendados: roda `fn` só se esta instância pegar o lock (sem
 * esperar). Devolve true se rodou, false se outra instância já estava rodando
 * (ou o banco não respondeu). NUNCA rejeita — pode ser chamado com `void`
 * dentro de setInterval sem virar unhandled rejection.
 */
export async function executarComLock(
  prisma: PrismaParaLock | null | undefined,
  nome: string,
  fn: () => Promise<void | boolean>,
  opcoes: OpcoesLock = {},
): Promise<boolean> {
  let rodou = false;
  const intervalo = opcoes.intervaloMinimoMs;
  const ciclo = opcoes.cicloDeNegocio;
  const estado = intervalo || ciclo ? estadoDosJobs(prisma) : null;
  const chaveUltima = `job:${nome}:ultima`;
  try {
    const r = await comLock(
      prisma,
      nome,
      async () => {
        let chaveCiclo: string | null = null;
        if (estado && ciclo) {
          const k = ciclo();
          if (!k) return false; // porta de calendário fechada: não roda nem marca
          chaveCiclo = `job:${nome}:ciclo:${k}`;
          if (await estado.obter(chaveCiclo)) return false;
        }
        if (estado && intervalo) {
          const ultima = (await estado.obter<number>(chaveUltima))?.valor;
          // 90% do período: os relógios dos timers das duas instâncias não
          // estão alinhados, e um tick 1 min "adiantado" não pode pular o ciclo.
          if (typeof ultima === 'number' && Date.now() - ultima < intervalo * 0.9) return false;
        }
        const inicio = Date.now();
        rodou = true;
        const trabalhou = await fn();
        // `fn` devolveu false = não fez o trabalho (porta interna fechada):
        // não marca. Falha (exceção) também não marca — a próxima passada,
        // em qualquer instância, tenta de novo.
        if (trabalhou === false) return false;
        if (estado && chaveCiclo) await estado.definir(chaveCiclo, inicio, opcoes.cicloTtlMs ?? 40 * 24 * 60 * 60 * 1000);
        // Marca o INÍCIO: o próximo período conta de quando o job começou.
        if (estado && intervalo) await estado.definir(chaveUltima, inicio, intervalo * 2);
        return true;
      },
      opcoes,
    );
    if (!r.obtido) {
      logger.debug(`Job "${nome}" já está rodando em outra instância — pulando`);
      return false;
    }
    return r.valor;
  } catch (err: any) {
    if (rodou) {
      logger.error(`Job "${nome}" falhou: ${err?.message ?? err}`);
      return true;
    }
    logger.warn(`Não consegui pegar o lock do job "${nome}" (${err?.message ?? err}) — pulando este ciclo`);
    return false;
  }
}

/** Espera `p`, mas só até `ms`: estourou, segue sem esperar (o lock é solto). */
function comPrazo<T>(p: Promise<T>, ms: number, nome: string): Promise<T | typeof PRAZO_ESTOURADO> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let estourou = false;
  // Se o prazo estourar e o job falhar depois, o erro não pode virar
  // unhandled rejection (derrubaria o processo).
  p.catch((err: any) => {
    if (estourou) logger.error(`Job "${nome}" falhou depois do prazo: ${err?.message ?? err}`);
  });
  const prazo = new Promise<typeof PRAZO_ESTOURADO>((resolve) => {
    timer = setTimeout(() => {
      estourou = true;
      logger.error(`Job "${nome}" passou de ${Math.round(ms / 60000)} min com o lock — liberando o lock; o job segue sem exclusividade`);
      resolve(PRAZO_ESTOURADO);
    }, ms);
    timer.unref?.();
  });
  return Promise.race([p, prazo]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
