import { ForbiddenException } from '@nestjs/common';
import { VisitantesService } from './visitantes.service';

describe('Visitantes — auth_respondido_por e inbox usam idUsuarioDoToken', () => {
  const ENV = process.env['PESSOAS_MIGRATION_ENABLED'];
  beforeAll(() => { delete process.env['PESSOAS_MIGRATION_ENABLED']; });
  afterAll(() => { if (ENV !== undefined) process.env['PESSOAS_MIGRATION_ENABLED'] = ENV; });

  function build() {
    const visitor = {
      id: 5, nome: 'João', doc_identificacao: '123', id_apartamento: 10, id_condominio: 1, bloqueado: 0,
      is_prestador: 0, liberado: 0, auth_status: 'pendente', foto_pessoa: null, user: null,
      apartamento: { bloco: 'A', apto: '101' },
    };
    const prisma: any = {
      isConnected: true,
      visitantes: {
        findUnique: jest.fn(async () => ({ ...visitor })),
        update: jest.fn(async ({ data }: any) => ({ ...visitor, ...data })),
        findMany: jest.fn(async () => []),
      },
      users: { findMany: jest.fn(async () => []), findUnique: jest.fn(async () => null) },
      apartamentos_Users: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => [{ id_apto: 10 }]) },
    };
    const svc = new VisitantesService(
      prisma,
      { sendPushNotification: jest.fn(), sendWhatsApp: jest.fn() } as any,
      {} as any,
      { syncVisitante: jest.fn(async () => ({ ok: true })) } as any,
      { registrar: jest.fn(async () => ({})) } as any,
      { assertCondominio: jest.fn(async () => undefined) } as any,
      { emitToCondominio: jest.fn() } as any,
    );
    return { svc, prisma };
  }

  it('check-in do porteiro que resolve o pedido pendente grava auth_respondido_por = null', async () => {
    const { svc, prisma } = build();
    await svc.checkIn(5, { sub: 20, nome: 'Portaria', id_condominio: 1, turno: 'Manha', tipo_sub: 'funcionario_portaria' } as any);
    expect(prisma.visitantes.update.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ auth_status: 'autorizado', auth_respondido_por: null }),
    );
  });

  it('check-in do síndico no console grava o Users.id dele', async () => {
    const { svc, prisma } = build();
    await svc.checkIn(5, { sub: 3, nome: 'Síndico', id_condominio: 1, typeAccess: 'Sindico' } as any);
    expect(prisma.visitantes.update.mock.calls[0][0].data.auth_respondido_por).toBe(3);
  });

  it('inbox de pendentes recusa token sem Users.id (CRM) em vez de usar o sub', async () => {
    const { svc, prisma } = build();
    await expect(svc.listarPendentes(undefined, { sub: 20, role: 'crm_admin' } as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.apartamentos_Users.findMany).not.toHaveBeenCalled();
  });
});
