import { INestApplication, Logger } from '@nestjs/common';
import type * as XRayCore from 'aws-xray-sdk-core';
import type * as XRayExpress from 'aws-xray-sdk-express';

/**
 * Rastreamento distribuído com AWS X-Ray (só quando `xrayAtivo()`).
 *
 * Cada requisição HTTP vira um segmento `prestare-api`; as chamadas de saída
 * (http/https: axios, Superlógica, WhatsApp, Firebase...) e os clientes do AWS
 * SDK v3 embrulhados por `rastrearClienteAws` viram subsegmentos.
 *
 * O daemon do X-Ray roda na própria instância do Elastic Beanstalk (ligado por
 * `.ebextensions/xray.config`) e recebe os segmentos por UDP: se ele estiver
 * fora do ar, o envio se perde em silêncio. Fora de uma requisição (cron,
 * filas) não há segmento aberto; nesse caso só registramos em nível debug —
 * nunca lançamos, para o rastreamento jamais derrubar uma requisição.
 *
 * Os pacotes do SDK são carregados sob demanda para não pesar (async_hooks do
 * cls-hooked) nos testes e no ambiente de desenvolvimento.
 */

const NOME_SEGMENTO = 'prestare-api';
const logger = new Logger('XRay');
let sdkConfigurado = false;

/**
 * O X-Ray liga com a flag `--xray` na linha de comando (Procfile do EB:
 * `web: node main.js --xray`) ou com NODE_ENV=production. O EB não define
 * NODE_ENV e não cabe variável nova no env (limite de 4096 caracteres).
 */
export function xrayAtivo(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return argv.includes('--xray') || env.NODE_ENV === 'production';
}

function carregarCore(): typeof XRayCore {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('aws-xray-sdk-core');
}

/** Configura o SDK uma única vez: logger, contexto ausente e HTTP de saída. */
function configurarSdk(core: typeof XRayCore): void {
  if (sdkConfigurado) return;
  sdkConfigurado = true;

  // Mensagens do SDK passam pelo logger do Nest; nada de erro de nível alto
  // por falta de daemon/arquivo do EB.
  core.setLogger({
    debug: (...args: unknown[]) => logger.debug(args.join(' ')),
    info: (...args: unknown[]) => logger.verbose(args.join(' ')),
    warn: (...args: unknown[]) => logger.warn(args.join(' ')),
    error: (...args: unknown[]) => logger.warn(args.join(' ')),
  });

  // Sem segmento aberto (código fora de uma requisição): ignora em silêncio.
  core.setContextMissingStrategy((msg: string) => logger.debug(msg));

  // Metadados do ambiente do Elastic Beanstalk no segmento.
  core.config([core.plugins.ElasticBeanstalkPlugin]);

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  core.captureHTTPsGlobal(require('http'));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  core.captureHTTPsGlobal(require('https'));
}

/**
 * Liga o X-Ray na aplicação. Deve ser chamado logo depois de criar o app,
 * antes dos outros middlewares, para o segmento cobrir a requisição inteira.
 * Com o X-Ray inativo não faz nada.
 */
export function instalarXRay(app: INestApplication): void {
  if (!xrayAtivo()) return;
  try {
    const core = carregarCore();
    configurarSdk(core);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const express: typeof XRayExpress = require('aws-xray-sdk-express');
    // O segmento fecha sozinho no 'finish' da resposta; o closeSegment do
    // Express não é usado porque os erros são tratados pelos filtros do Nest.
    app.use(express.openSegment(NOME_SEGMENTO));
    logger.log(`X-Ray ativo (segmento ${NOME_SEGMENTO})`);
  } catch (err) {
    logger.warn(`X-Ray não iniciado: ${(err as Error)?.message ?? err}`);
  }
}

/**
 * Embrulha um cliente do AWS SDK v3 para gerar subsegmentos com o nome do
 * serviço e da operação. Com o X-Ray inativo devolve o próprio cliente.
 */
export function rastrearClienteAws<T>(cliente: T): T {
  if (!xrayAtivo()) return cliente;
  try {
    const core = carregarCore();
    configurarSdk(core);
    return core.captureAWSv3Client(cliente as any) as T;
  } catch (err) {
    logger.warn(`X-Ray: cliente AWS sem rastreamento: ${(err as Error)?.message ?? err}`);
    return cliente;
  }
}
