import { Logger } from '@nestjs/common';
import { GetParametersByPathCommand, SSMClient } from '@aws-sdk/client-ssm';
import { credenciaisContaPrestare } from './aws-credenciais.util';
import { xrayAtivo } from './xray';

const PREFIXO_PADRAO = '/prestare/api/';
const TIMEOUT_TOTAL_MS = 15000;
/** Sem estas variáveis a API subiria degradada (Prisma em modo mock, JWT/token internos ausentes). */
const OBRIGATORIAS = ['DATABASE_URL', 'JWT_SECRET', 'INTERNAL_SYNC_TOKEN'];

/**
 * Carrega os segredos do SSM Parameter Store (/prestare/api/<NOME_DA_ENV>) para
 * process.env, no boot e ANTES de qualquer módulo ler o ambiente.
 *
 * A env já definida e não vazia sempre vence: dev e o env atual do Elastic
 * Beanstalk seguem funcionando. Só roda na AWS (mesma regra do X-Ray). Qualquer
 * falha (sem credenciais, rede, AccessDenied, timeout) vira um aviso e devolve
 * 0; nunca lança. Devolve quantas variáveis foram preenchidas.
 */
export async function carregarSegredosSsm(
  opts: {
    prefixo?: string;
    cliente?: SSMClient;
    env?: NodeJS.ProcessEnv;
    obrigatorias?: string[];
    sair?: (codigo: number) => void;
  } = {},
): Promise<number> {
  const env = opts.env ?? process.env;
  if (!xrayAtivo(process.argv, env)) return 0;

  const logger = new Logger('SegredosSsm');
  const prefixo = opts.prefixo ?? PREFIXO_PADRAO;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_TOTAL_MS);
  try {
    const cliente =
      opts.cliente ??
      new SSMClient({
        region: 'sa-east-1',
        credentials: credenciaisContaPrestare(),
        maxAttempts: 3,
        requestHandler: { connectionTimeout: 3000, requestTimeout: 5000 },
      });
    let preenchidas = 0;
    let token: string | undefined;
    do {
      const resp = await cliente.send(
        new GetParametersByPathCommand({
          Path: prefixo,
          Recursive: false,
          WithDecryption: true,
          NextToken: token,
        }),
        { abortSignal: abort.signal },
      );
      for (const p of resp.Parameters ?? []) {
        const nome = p.Name?.split('/').pop();
        if (!nome || p.Value === undefined) continue;
        if (env[nome] === undefined || env[nome] === '') {
          env[nome] = p.Value;
          preenchidas++;
        }
      }
      token = resp.NextToken;
    } while (token);
    logger.log(`${preenchidas} segredo(s) carregado(s) do SSM`);
    return preenchidas;
  } catch (err) {
    logger.warn(`Segredos do SSM não carregados: ${(err as Error)?.name ?? 'erro'} ${(err as Error)?.message ?? ''}`.trim());
    return 0;
  } finally {
    clearTimeout(timer);
    // Na AWS, subir sem as variáveis críticas deixaria a API degradada em
    // silêncio; encerrar faz o Elastic Beanstalk marcar o deploy como não saudável.
    const faltando = (opts.obrigatorias ?? OBRIGATORIAS).filter((n) => !env[n]);
    if (faltando.length) {
      logger.error(`Variáveis obrigatórias ausentes (env e SSM): ${faltando.join(', ')}. Encerrando.`);
      (opts.sair ?? ((c: number) => process.exit(c)))(1);
    }
  }
}
