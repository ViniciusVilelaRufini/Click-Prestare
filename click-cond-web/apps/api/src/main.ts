import * as dns from 'dns';
// Railway egress nao tem rota IPv6 — forca IPv4 primeiro em todas as
// resolucoes DNS do processo. Tem que rodar ANTES de qualquer modulo
// que faca lookup (smtp, prisma, axios, etc).
dns.setDefaultResultOrder('ipv4first');

import { Logger, ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { join } from 'path';
import { AppModule } from './app/app.module';
import { AllExceptionsFilter } from './app/common/filters/all-exceptions.filter';
import { json, urlencoded } from 'express';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });

  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ limit: '50mb', extended: true }));

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

  const allowedOriginsEnv = process.env.CORS_ORIGINS;
  const defaultOrigins = [
    'http://localhost:4200',
    'http://localhost:3000',
    'http://localhost:5173',
    'https://click-prestare.vercel.app',
    'https://crm-click-prestare.vercel.app',
    'https://clickprestarecondominios.com.br',
    'https://www.clickprestarecondominios.com.br',
    'https://kabania.vercel.app',
  ];
  const allowedOrigins = allowedOriginsEnv
    ? allowedOriginsEnv.split(',').map((o) => o.trim()).filter(Boolean)
    : defaultOrigins;

  // Assinatura (req, callback): dá acesso à URL para liberar rotas públicas.
  app.enableCors((req: any, callback: (err: Error | null, options?: any) => void) => {
    const origin: string | undefined = req.headers?.origin;

    // Endpoints públicos de webhook/simulador de dispositivos: chamados por
    // hardware (catraca/leitor) e pelas páginas de simulador a partir de
    // QUALQUER host. Não há cookie/credencial — libera qualquer origem.
    const path: string = req.originalUrl || req.url || '';
    if (/^\/api\/facial\/(webhook|sim|simulator)\b/.test(path)) {
      return callback(null, { origin: true, credentials: false });
    }

    // Demais rotas: whitelist (mantém credentials para o cookie/JWT do console).
    if (!origin) return callback(null, { origin: true, credentials: true });
    if (allowedOrigins.includes(origin)) {
      return callback(null, { origin: true, credentials: true });
    }
    // Permite qualquer localhost (Flutter web usa porta dinâmica)
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, { origin: true, credentials: true });
    }
    return callback(new Error(`Origem não permitida por CORS: ${origin}`));
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
