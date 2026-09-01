import { ForbiddenException } from '@nestjs/common';
import { VisitantesService } from './visitantes.service';

/**
 * Portaria remota — autorização de visitante em tempo real.
 *
 * - solicitarAutorizacao (porteiro): deixa PENDENTE (liberado=0) e dispara push.
 * - autorizar (morador): libera (liberado=1) e enrola no facial.
 * - negar (morador): mantém bloqueado (liberado=0).
 * - escopo: morador só age em visitante de apartamento vinculado a ele.
 * - override: check-in do porteiro resolve um pedido pendente.
 *
 * Testa o wiring com mocks — sem banco, sem device, sem FCM real.
 */
describe('VisitantesService — portaria remota', () => {
  const APTO_DONO = 10;

  function build(visitorOverrides: Record<string, any> = {}) {
    const visitor = {
      id: 5,
      nome: 'João',
      doc_identificacao: '123',
      id_apartamento: APTO_DONO,
      id_condominio: 1,
      bloqueado: 0,
      is_prestador: 0,
      liberado: 1,
      auth_status: null,
      foto_pessoa: null,
      user: null,
      apartamento: { bloco: 'A', apto: '101' },
      ...visitorOverrides,
    };

    const notifications = {
      sendPushNotification: jest.fn(async () => ({})),
      sendWhatsApp: jest.fn(async () => ({})),
    };
    const facial = { syncVisitante: jest.fn(async () => ({ ok: true })) };
    const auditoria = { registrar: jest.fn(async () => ({})) };
    const tenant = { assertCondominio: jest.fn(async () => undefined) };

    const prisma: any = {
      isConnected: true,
      visitantes: {
        findUnique: jest.fn(async () => ({ ...visitor })),
        update: jest.fn(async ({ data }: any) => ({ ...visitor, ...data })),
        findMany: jest.fn(async () => []),
      },
      users: {
        findMany: jest.fn(async () => [{ fcm_token: 'token-valido-fcm-1', name: 'Maria', phone: null }]),
        findUnique: jest.fn(async () => null),
      },
      apartamentos_Users: {
        findFirst: jest.fn(async ({ where }: any) =>
          where.id_user === 20 && where.id_apto === APTO_DONO ? { id_apto: APTO_DONO } : null,
        ),
        findMany: jest.fn(async () => [{ id_apto: APTO_DONO }]),
      },
    };

    // O gateway de tempo real avisa a portaria-web da solicitação; no teste
    // só precisa existir para o service poder chamá-lo.
    const realtime: any = { emitToCondominio: jest.fn() };

    const svc = new VisitantesService(
      prisma,
      notifications as any,
      {} as any,
      facial as any,
      auditoria as any,
      tenant as any,
      realtime as any,
    );
    return { svc, prisma, notifications, facial, auditoria, realtime };
  }

  const porteiro = { id_condominio: 1, nome: 'Porteiro', sub: 99 } as any;
  const moradorDono = { user: { id: 20 }, sub: 20, typeAccess: 'Morador' } as any;
  const moradorIntruso = { user: { id: 77 }, sub: 77, typeAccess: 'Morador' } as any;

  it('solicitarAutorizacao (porteiro) → pendente, liberado=0, dispara push', async () => {
    const { svc, prisma, notifications } = build();
    const res = await svc.solicitarAutorizacao(5, porteiro);

    expect(res).toEqual({ ok: true });
    expect(prisma.visitantes.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5 },
        data: expect.objectContaining({ auth_status: 'pendente', liberado: 0 }),
      }),
    );
    expect(notifications.sendPushNotification).toHaveBeenCalledTimes(1);
    expect(notifications.sendPushNotification).toHaveBeenCalledWith(
      'token-valido-fcm-1',
      expect.any(String),
      expect.stringContaining('João'),
      expect.objectContaining({ type: 'autorizacao_visitante', id: '5' }),
    );
  });

  it('autorizar (morador dono) → liberado=1, autorizado, enrola no facial', async () => {
    const { svc, prisma, facial } = build();
    const res = await svc.autorizar(5, moradorDono);

    expect(res).toEqual({ ok: true });
    expect(prisma.visitantes.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5 },
        data: expect.objectContaining({
          auth_status: 'autorizado',
          liberado: 1,
          auth_respondido_por: 20,
        }),
      }),
    );
    expect(facial.syncVisitante).toHaveBeenCalledWith(5);
  });

  it('autorizar com darEntrada=true → liberado=1, data_entrada preenchida, enrola no facial e emite checkin', async () => {
    const { svc, prisma, facial, realtime } = build();
    const res = await svc.autorizar(5, moradorDono, true);

    expect(res).toEqual({ ok: true });
    expect(prisma.visitantes.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5 },
        data: expect.objectContaining({
          auth_status: 'autorizado',
          liberado: 1,
          data_entrada: expect.any(Date),
          data_saida: null,
          auth_respondido_por: 20,
        }),
      }),
    );
    expect(facial.syncVisitante).toHaveBeenCalledWith(5);
    expect(realtime.emitToCondominio).toHaveBeenCalledWith(
      1,
      'visitante.autorizado',
      expect.objectContaining({ id: 5, darEntrada: true }),
    );
    expect(realtime.emitToCondominio).toHaveBeenCalledWith(1, 'visitante.checkin', { id: 5 });
  });

  it('negar (morador dono) → negado, liberado=0', async () => {
    const { svc, prisma } = build();
    await svc.negar(5, moradorDono);
    expect(prisma.visitantes.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ auth_status: 'negado', liberado: 0 }),
      }),
    );
  });

  it('morador de outro apto → Forbidden (não autoriza visitante alheio)', async () => {
    const { svc } = build();
    await expect(svc.autorizar(5, moradorIntruso)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('check-in do porteiro resolve um pedido pendente (override)', async () => {
    const { svc, prisma } = build({ auth_status: 'pendente' });
    await svc.checkIn(5, porteiro);
    expect(prisma.visitantes.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ liberado: 1, auth_status: 'autorizado' }),
      }),
    );
  });

  it('listarPendentes retorna pendentes dos aptos do morador', async () => {
    const { svc, prisma } = build();
    prisma.visitantes.findMany.mockResolvedValueOnce([
      {
        id: 5,
        nome: 'João',
        doc_identificacao: '123',
        foto_pessoa: null,
        is_prestador: 0,
        auth_solicitado_em: new Date(),
        apartamento: { bloco: 'A', apto: '101' },
      },
    ]);
    const res = await svc.listarPendentes(1, moradorDono);
    expect(res).toHaveLength(1);
    expect(res[0]).toEqual(expect.objectContaining({ id: 5, nome: 'João', apto: '101' }));
  });
});
