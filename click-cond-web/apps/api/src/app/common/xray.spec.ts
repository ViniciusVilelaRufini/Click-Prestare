import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { instalarXRay, rastrearClienteAws, xrayAtivo } from './xray';

@Controller('ping')
class PingController {
  @Get()
  ping() {
    return { ok: true };
  }

  @Get('segmento')
  segmento() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const core = require('aws-xray-sdk-core');
    return { nome: core.getSegment()?.name ?? null };
  }
}

@Module({ controllers: [PingController] })
class PingModule {}

describe('xrayAtivo', () => {
  it('liga com a flag --xray mesmo sem NODE_ENV', () => {
    expect(xrayAtivo(['node', 'main.js', '--xray'], {})).toBe(true);
  });

  it('liga com NODE_ENV=production', () => {
    expect(xrayAtivo(['node', 'main.js'], { NODE_ENV: 'production' })).toBe(true);
  });

  it('fica desligado sem a flag e fora de produção', () => {
    expect(xrayAtivo(['node', 'main.js'], {})).toBe(false);
    expect(xrayAtivo(['node', 'main.js'], { NODE_ENV: 'development' })).toBe(false);
  });
});

describe('instalarXRay', () => {
  const nodeEnvOriginal = process.env.NODE_ENV;
  const argvOriginal = process.argv;
  let app: INestApplication | undefined;

  afterEach(async () => {
    process.env.NODE_ENV = nodeEnvOriginal;
    process.argv = argvOriginal;
    await app?.close();
    app = undefined;
  });

  it('fora de produção não registra middleware e não lança', () => {
    process.env.NODE_ENV = 'test';
    const use = jest.fn();
    const fake = { use } as unknown as INestApplication;

    expect(() => instalarXRay(fake)).not.toThrow();
    expect(use).not.toHaveBeenCalled();
  });

  it('fora de produção devolve o cliente AWS sem embrulhar', () => {
    process.env.NODE_ENV = 'test';
    const cliente = { send: jest.fn(), middlewareStack: { add: jest.fn() } };

    expect(rastrearClienteAws(cliente)).toBe(cliente);
    expect(cliente.middlewareStack.add).not.toHaveBeenCalled();
  });

  it('com --xray (sem NODE_ENV=production) registra o middleware', () => {
    process.env.NODE_ENV = 'test';
    process.argv = [...argvOriginal, '--xray'];
    const use = jest.fn();

    instalarXRay({ use } as unknown as INestApplication);

    expect(use).toHaveBeenCalledTimes(1);
  });

  it('em produção, sem daemon, a requisição responde 200', async () => {
    process.env.NODE_ENV = 'production';
    app = await NestFactory.create(PingModule, { logger: false });
    instalarXRay(app);
    await app.listen(0);
    const url = await app.getUrl();

    const resposta = await fetch(`${url.replace('[::1]', '127.0.0.1')}/ping`);

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ ok: true });

    const comSegmento = await fetch(`${url.replace('[::1]', '127.0.0.1')}/ping/segmento`);
    expect(comSegmento.status).toBe(200);
    expect(await comSegmento.json()).toEqual({ nome: 'prestare-api' });
  });
});
