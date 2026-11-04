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
   * evita as duas rodarem no mesmo período (A às 9:10, B às 9:40 — dois
   * lembretes de cobrança). Com isto, a última execução bem-sucedida fica em
   * estado_compartilhado e quem chegar antes de 90% do período pula.
   */
  intervaloMinimoMs?: number;
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

  await prisma!.$transaction!(
    async (tx: any) => {
      const linhas: Array<{ ok: unknown }> = await tx.$queryRaw`SELECT GET_LOCK(${chave}, ${espera}) AS ok`;
      // 1 = pegou; 0 = ocupado (timeout); NULL = erro. BigInt no driver MySQL.
      if (Number(linhas?.[0]?.ok) !== 1) return;
      try {
        resultado = { obtido: true, valor: await comPrazo(fn(), duracaoMaxima, nome) };
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
  fn: () => Promise<void>,
  opcoes: OpcoesLock = {},
): Promise<boolean> {
  let rodou = false;
  const intervalo = opcoes.intervaloMinimoMs;
  const estado = intervalo ? new EstadoCompartilhado(prisma as any) : null;
  const chaveUltima = `job:${nome}:ultima`;
  try {
    const r = await comLock(
      prisma,
      nome,
      async () => {
        if (estado && intervalo) {
          const ultima = (await estado.obter<number>(chaveUltima))?.valor;
          // 90% do período: os relógios dos timers das duas instâncias não
          // estão alinhados, e um tick 1 min "adiantado" não pode pular o ciclo.
          if (typeof ultima === 'number' && Date.now() - ultima < intervalo * 0.9) return false;
        }
        rodou = true;
        await fn();
        // Só marca depois de concluir: falha deixa a próxima passada (em
        // qualquer instância) tentar de novo.
        if (estado && intervalo) await estado.definir(chaveUltima, Date.now(), intervalo * 2);
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
function comPrazo<T>(p: Promise<T>, ms: number, nome: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let estourou = false;
  // Se o prazo estourar e o job falhar depois, o erro não pode virar
  // unhandled rejection (derrubaria o processo).
  p.catch((err: any) => {
    if (estourou) logger.error(`Job "${nome}" falhou depois do prazo: ${err?.message ?? err}`);
  });
  const prazo = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      estourou = true;
      logger.error(`Job "${nome}" passou de ${Math.round(ms / 60000)} min com o lock — liberando o lock; o job segue sem exclusividade`);
      resolve(undefined as T);
    }, ms);
    timer.unref?.();
  });
  return Promise.race([p, prazo]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
