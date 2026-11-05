import * as dns from 'dns';
// Força IPv4 primeiro em todas as resoluções DNS do processo. Tem que rodar
// ANTES de qualquer módulo que faça lookup (smtp, prisma, axios, etc).
dns.setDefaultResultOrder('ipv4first');

// Carrega .env se presente no diretório da aplicação (fallback de produção/Beanstalk)
if (typeof (process as any).loadEnvFile === 'function') {
  try {
    (process as any).loadEnvFile();
  } catch {
    // Ignora se não houver arquivo .env
  }
}

// Credenciais SMTP vêm só do ambiente (Elastic Beanstalk). Nada de senha no código.


import { Logger, ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { join } from 'path';
import { carregarSegredosSsm } from './app/common/segredos-ssm';
import { AllExceptionsFilter } from './app/common/filters/all-exceptions.filter';
import { parserDeCorpo } from './app/common/limite-corpo';
import { resolveJwtSecret } from './app/auth/jwt-secret';
import { requestContext, extractClientIp } from './app/common/context/request-context';
import { caminhoEstaticoBloqueado } from './app/common/assets-estaticos.util';
import { ROTAS_HARDWARE, origensConfiaveis } from './app/common/cors-origins';
import { instalarXRay } from './app/common/xray';

// Rede de segurança: uma promessa rejeitada e esquecida (sem await) derruba o
// processo Node (padrão do Node 15+) e, com ele, todos os condomínios.
process.on('unhandledRejection', (reason) => {
  new Logger('UnhandledRejection').error(
    reason instanceof Error ? (reason.stack ?? reason.message) : String(reason),
  );
});

async function bootstrap() {
  // Segredos do SSM antes de qualquer módulo da aplicação ser carregado: vários
  // módulos leem process.env no import (ex.: FACIAL_DISABLED, PHONE_ID). Por isso
  // o AppModule é importado dinamicamente, só depois.
  await carregarSegredosSsm();
  // require (e não import()) para o bundler resolver o caminho sem extensão.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AppModule } = require('./app/app.module') as typeof import('./app/app.module.js');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });

  // AWS X-Ray (flag --xray do Procfile ou NODE_ENV=production): primeiro middleware, para o segmento cobrir a
  // requisição inteira. Sem daemon, os segmentos se perdem sem erro.
  instalarXRay(app);

  // trust proxy = 3 saltos: nginx da instância -> ALB -> CloudFront. Medido em
  // 04/11/2026 no access.log do nginx: XFF "cliente, <borda CloudFront>" vindo do
  // ALB; com 2 o req.ip virava o IP da borda do CloudFront e o throttle por IP
  // juntava clientes diferentes. Os SGs só deixam o CloudFront chegar no ALB e o
  // ALB nas instâncias, então o XFF à esquerda desses 3 saltos não é forjável.
  app.set('trust proxy', 3);

  // Armazena o IP da máquina do cliente no AsyncLocalStorage para logs de auditoria automáticos
  app.use((req: any, _res: any, next: any) => {
    const ip = extractClientIp(req);
    requestContext.run({ ip, userAgent: req.headers?.['user-agent'] }, () => {
      next();
    });
  });

  // Corpo JSON/urlencoded com teto por rota (pentest P-06): 2 MB por padrão;
  // só as rotas de upload em base64 vão a 35 MB, e só com JWT válido. Inclui
  // o corpo bruto do webhook do WhatsApp (HMAC) e o XML das câmeras Hikvision.
  // Detalhes e lista de rotas em common/limite-corpo.ts.
  app.use(parserDeCorpo(resolveJwtSecret()));

  // Helmet: CSP desabilitada porque os simuladores HTML em /assets carregam
  // bibliotecas de CDN (face-api.js, jsQR). Demais headers ficam ligados:
  //   - HSTS força HTTPS (importante: token JWT está no Authorization header)
  //   - X-Frame-Options bloqueia clickjacking
  //   - X-Content-Type-Options previne MIME sniffing
  //   - Referrer-Policy limita info vazada em links externos
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      hsts: { maxAge: 15552000, includeSubDomains: true, preload: true },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );

  // Serve arquivos estáticos copiados de src/assets (simulador facial em /simulator.html)
  // Só HTML dos simuladores. Nenhum .json/credencial pode sair por aqui — e o
  // filtro olha o caminho DECODIFICADO, igual ao que o serve-static abre.
  app.use((req: any, res: any, next: any) => {
    if (caminhoEstaticoBloqueado(req.path)) {
      return res.status(404).end();
    }
    next();
  });
  app.useStaticAssets(join(__dirname, 'assets'));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const httpAdapterHost = app.get(HttpAdapterHost);
  app.useGlobalFilters(new AllExceptionsFilter(httpAdapterHost));

  // A env CORS_ORIGINS do Beanstalk ainda carrega resíduo da Vercel.
  // origensConfiaveis() já o descarta (domínio .vercel.app abandonado pode ser
  // RECLAMADO por terceiros); aqui só avisamos para a variável ser limpa.
  const vercelResiduo = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim().replace(/^["']|["']$/g, ''))
    .filter((o) => /\.vercel\.app$/i.test(o));
  if (vercelResiduo.length) {
    Logger.warn(
      `CORS: ignorando ${vercelResiduo.length} origem(ns) .vercel.app vindas de CORS_ORIGINS (${vercelResiduo.join(', ')}). ` +
        'Limpe essa variável no Elastic Beanstalk.',
      'Bootstrap',
    );
  }

  const allowedOrigins = origensConfiaveis();

  // Assinatura (req, callback): dá acesso à URL para liberar rotas públicas.
  app.enableCors((req: any, callback: (err: Error | null, options?: any) => void) => {
    // Endpoints públicos de webhook/simulador de dispositivos: chamados por
    // hardware (catraca/leitor) e pelas páginas de simulador a partir de
    // QUALQUER host. Não há cookie/credencial — libera qualquer origem.
    const path: string = req.originalUrl || req.url || '';
    if (ROTAS_HARDWARE.test(path)) {
      return callback(null, { origin: true, credentials: false });
    }

    // O header `Date` (hora do servidor) não é um "simple response header", então
    // sem isto o navegador o esconde do JavaScript em requisição cross-origin.
    // O console usa esse header para descobrir o quanto o relógio da MÁQUINA do
    // usuário está errado e mostrar a hora certa mesmo assim — o PC da portaria
    // costuma rodar sem sincronização de horário (visto em produção: 91s
    // adiantado). Ver ServerClockService.
    const exposedHeaders = ['Date'];

    // Sem header Origin: app Flutter, curl, hardware e chamada servidor-a-servidor.
    // Não é requisição de navegador, logo não há origem cross-site para barrar.
    const origin: string | undefined = req.headers?.origin;
    if (!origin) {
      return callback(null, { origin: true, credentials: true, exposedHeaders });
    }

    // Origem conhecida: reflete só ela (nunca "*") e libera credenciais.
    if (allowedOrigins.includes(origin)) {
      return callback(null, { origin, credentials: true, exposedHeaders });
    }

    // Origem desconhecida: responde SEM header CORS, então o navegador bloqueia
    // a leitura da resposta. Não lança erro — devolver 500 aqui esconderia a
    // causa real e quebraria o preflight de forma difícil de diagnosticar.
    return callback(null, { origin: false, credentials: false, exposedHeaders });
  });

  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);
  const port = process.env.PORT || 3000;
  await app.listen(port);
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/${globalPrefix}`,
  );
}

bootstrap();
