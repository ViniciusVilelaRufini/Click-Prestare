import { CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { get } from 'node:http';
import { AddressInfo } from 'node:net';
import { PassThrough, Readable } from 'node:stream';
import { CrmAdminGuard } from '../crm/crm-admin.guard';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappConfigService } from './whatsapp-config.service';
import { WhatsappCrmController } from './whatsapp-crm.controller';
import { WhatsappInboxService } from './whatsapp-inbox.service';

class SemSessaoGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    throw new UnauthorizedException();
  }
}

describe('WhatsappCrmController', () => {
  it('download de mídia sem sessão retorna 401 antes de abrir o armazenamento', async () => {
    const inbox = { abrirMidia: jest.fn() };
    const modulo = await Test.createTestingModule({
      controllers: [WhatsappCrmController],
      providers: [
        { provide: WhatsappInboxService, useValue: inbox },
        { provide: WhatsappConfigService, useValue: {} },
        CrmAdminGuard,
        { provide: PrismaService, useValue: { isConnected: false } },
        { provide: APP_GUARD, useClass: SemSessaoGuard },
      ],
    }).overrideGuard(CrmAdminGuard).useValue({ canActivate: () => true }).compile();
    const app = modulo.createNestApplication();
    await app.init();
    const server = app.getHttpServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      const status = await new Promise<number>((resolve, reject) => {
        get(`http://127.0.0.1:${port}/crm/whatsapp/midias/1`, (res: any) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        }).on('error', reject);
      });
      expect(status).toBe(401);
      expect(inbox.abrirMidia).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('transmite mídia autenticada com MIME e intervalo solicitado', async () => {
    const inbox = {
      abrirMidia: jest.fn(async () => ({ stream: Readable.from([Buffer.from('bcd')]), mime: 'audio/ogg', nome: 'audio.ogg', tamanho: 3, total: 6, inicio: 1, fim: 3 })),
    };
    const res: any = new PassThrough();
    res.status = jest.fn(() => res);
    res.setHeader = jest.fn();
    const partes: Buffer[] = [];
    res.on('data', (parte: Buffer) => partes.push(parte));
    const terminou = new Promise<void>((resolve) => res.on('end', resolve));

    await new WhatsappCrmController(inbox as any, {} as any).baixarMidia(9, 'bytes=1-3', res);
    await terminou;

    expect(Buffer.concat(partes).toString()).toBe('bcd');
    expect(res.status).toHaveBeenCalledWith(206);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'audio/ogg');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Range', 'bytes 1-3/6');
    expect(inbox.abrirMidia).toHaveBeenCalledWith(9, 'bytes=1-3');
  });
});
