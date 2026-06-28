import { CanActivate, ExecutionContext, INestApplication, Injectable } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import * as http from 'node:http';
import { VisitantesController, VisitantesGlobalController } from './visitantes.controller';
import { VisitantesService } from './visitantes.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import { TenantGuard } from '../auth/tenant.guard';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../common/storage/storage.service';
import { FacialService } from '../facial/facial.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Prova de ponta-a-ponta (pipeline HTTP real: guards → controller → service →
 * TenantAccessService) de que um SÍNDICO MOBILE — token sem id_condominio,
 * typeAccess 'Sindico' — é NEGADO ao operar sobre visitante de um condomínio
 * que ele não administra, e PERMITIDO no que administra.
 *
 * Sem supertest: usamos um JwtAuthGuard fake que injeta o payload do síndico
 * na request (substituindo a validação real do passport), e batemos no
 * servidor HTTP do Nest com o http nativo. O TenantGuard é o real.
 */

// Visitante 500 pertence ao condomínio 2.
const visitanteCond2 = { id: 500, id_condominio: 2, id_apartamento: 77, nome: 'Fulano', is_prestador: 0, face_id: null };

// Payload do síndico injetado em cada request (sem id_condominio, como no app).
let currentUser: JwtPayload = { sub: 9, nome: 'Síndico', typeAccess: 'Sindico' };

@Injectable()
class FakeJwtGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    ctx.switchToHttp().getRequest().user = currentUser;
    return true;
  }
}

function request(server: http.Server, method: string, path: string, body?: any): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const data = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      { host: '127.0.0.1', port, path, method, headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : null }));
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

describe('Visitantes — isolamento de tenant síndico mobile (e2e)', () => {
  let app: INestApplication;
  let server: http.Server;

  // Prisma mockado representando 2 condomínios e o vínculo do síndico só ao cond 2.
  const prisma: any = {
    isConnected: true,
    visitantes: {
      findUnique: jest.fn(async ({ where }: any) => (where.id === 500 ? { ...visitanteCond2 } : null)),
      update: jest.fn(async () => ({ ...visitanteCond2 })),
    },
    sindicos_Condominios: {
      findFirst: jest.fn(async ({ where }: any) => (where.id_user === 9 && where.id_condominio === 2 ? { id: 1 } : null)),
    },
    apartamentos_Users: { findFirst: jest.fn(async () => null) },
    // Mocks da lógica de negócio pós-autorização (não é o foco do teste,
    // mas precisa não quebrar para o caminho permitido chegar a 2xx).
    visitantes_updateMany: undefined,
    users: { findUnique: jest.fn(async () => null), findMany: jest.fn(async () => []) },
  };
  prisma.visitantes.updateMany = jest.fn(async () => ({ count: 0 }));

  beforeAll(async () => {
    const noop: any = { registrar: jest.fn(), sendPushNotification: jest.fn(), sendWhatsApp: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      controllers: [VisitantesController, VisitantesGlobalController],
      providers: [
        VisitantesService,
        TenantAccessService,
        Reflector,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: noop },
        { provide: StorageService, useValue: { isDataUrl: () => false, uploadDataUrl: jest.fn() } },
        { provide: FacialService, useValue: { syncVisitante: jest.fn().mockResolvedValue({}), unsyncVisitante: jest.fn() } },
        { provide: AuditoriaService, useValue: noop },
        // JwtAuthGuard real é trocado pelo fake; TenantGuard é o real.
        { provide: APP_GUARD, useClass: FakeJwtGuard },
        { provide: APP_GUARD, useClass: TenantGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    await new Promise<void>((r) => server.listen(0, r));
  });

  afterAll(async () => {
    await app?.close();
  });

  it('NEGA liberar acesso de visitante de condomínio que o síndico não administra', async () => {
    currentUser = { sub: 9, nome: 'Síndico sem vínculo', typeAccess: 'Sindico' };
    prisma.sindicos_Condominios.findFirst.mockImplementationOnce(async () => null); // não vinculado ao cond 2
    const res = await request(server, 'POST', '/visitantes/liberar', { id: 500 });
    expect(res.status).toBe(403);
    expect(prisma.visitantes.update).not.toHaveBeenCalled();
  });

  it('PERMITE quando o síndico administra o condomínio do visitante', async () => {
    currentUser = { sub: 9, nome: 'Síndico do cond 2', typeAccess: 'Sindico' };
    const res = await request(server, 'POST', '/visitantes/liberar', { id: 500 });
    expect(res.status).toBe(201);
    expect(prisma.visitantes.update).toHaveBeenCalled();
  });

  it('NEGA leitura (GET /visitantes/get) cross-tenant — vazamento de doc/foto', async () => {
    currentUser = { sub: 9, nome: 'Síndico sem vínculo', typeAccess: 'Sindico' };
    prisma.sindicos_Condominios.findFirst.mockImplementationOnce(async () => null);
    const res = await request(server, 'GET', '/visitantes/get?id=500');
    expect(res.status).toBe(403);
  });
});
