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

// Sanitização global: impede que resíduos de e-mail pessoal antigo fiquem no process.env


import { Logger, ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { join } from 'path';
import { AppModule } from './app/app.module';
import { AllExceptionsFilter } from './app/common/filters/all-exceptions.filter';
import { json, text, urlencoded } from 'express';
import { requestContext, extractClientIp } from './app/common/context/request-context';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });

  // Habilita trust proxy para ler IP correto através de proxies/load balancers (AWS CloudFront, ALB, etc.)
  app.set('trust proxy', true);

  // Armazena o IP da máquina do cliente no AsyncLocalStorage para logs de auditoria automáticos
  app.use((req: any, _res: any, next: any) => {
    const ip = extractClientIp(req);
    requestContext.run({ ip, userAgent: req.headers?.['user-agent'] }, () => {
      next();
    });
  });

  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ limit: '50mb', extended: true }));
  // Câmeras Hikvision postam notificação de evento em XML (não em JSON). Sem
  // este parser o corpo chegava VAZIO no webhook e a leitura de placa era
  // descartada em silêncio. O XML é convertido em webhook-payload.util.
  app.use(text({ limit: '10mb', type: ['text/xml', 'application/xml'] }));

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

  // Origens sempre confiáveis: os domínios que nós controlamos. Não inclui
  // *.vercel.app — a Vercel foi desativada na migração para a AWS, e domínio
  // .vercel.app abandonado pode ser RECLAMADO por terceiros, que passariam a
  // falar com esta API como origem confiável.
  const alwaysAllowed = [
    'https://clickprestarecondominios.com.br',
    'https://www.clickprestarecondominios.com.br',
    'https://main.d340ziyanv9pav.amplifyapp.com',
    'http://localhost:5173',
    'http://localhost:4200',
    'http://localhost:3000',
  ];

  // CORS_ORIGINS (env do Beanstalk) acrescenta origens à lista — não a substitui,
  // senão um valor mal preenchido derruba a portaria-web em produção.
  const allowedOriginsEnv = process.env.CORS_ORIGINS;
  const extraOrigins = allowedOriginsEnv
    ? allowedOriginsEnv.split(',').map((o) => o.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
    : [];

  // A env CORS_ORIGINS do Beanstalk ainda carrega resíduo da Vercel. Descartamos
  // aqui para que uma variável desatualizada não devolva confiança a um domínio
  // que hoje qualquer pessoa pode registrar.
  const vercelResiduo = extraOrigins.filter((o) => /\.vercel\.app$/i.test(o));
  const extraLimpas = extraOrigins.filter((o) => !/\.vercel\.app$/i.test(o));
  if (vercelResiduo.length) {
    Logger.warn(
      `CORS: ignorando ${vercelResiduo.length} origem(ns) .vercel.app vindas de CORS_ORIGINS (${vercelResiduo.join(', ')}). ` +
        'Limpe essa variável no Elastic Beanstalk.',
      'Bootstrap',
    );
  }

  const allowedOrigins = [...new Set([...alwaysAllowed, ...extraLimpas])];

  // Assinatura (req, callback): dá acesso à URL para liberar rotas públicas.
  app.enableCors((req: any, callback: (err: Error | null, options?: any) => void) => {
    // Endpoints públicos de webhook/simulador de dispositivos: chamados por
    // hardware (catraca/leitor) e pelas páginas de simulador a partir de
    // QUALQUER host. Não há cookie/credencial — libera qualquer origem.
    const path: string = req.originalUrl || req.url || '';
    if (/^\/api\/facial\/(webhook|sim|simulator)\b/.test(path)) {
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
