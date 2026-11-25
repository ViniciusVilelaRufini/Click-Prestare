import { AreasSociaisService } from './areas-sociais.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * O push "status da reserva" é para avisar o dono da reserva de uma mudança
 * que OUTRA pessoa fez (síndico aprovou, recusou ou cancelou). Quando o
 * próprio morador cancela, ele acabou de tocar no botão — receber um aviso
 * "sua reserva mudou para cancelado" logo depois é ruído.
 */
describe('AreasSociaisService — push de status da reserva', () => {
  // As reservas destes testes são de 10/06/2026; o relógio fica antes delas.
  beforeAll(() => jest.useFakeTimers({ advanceTimers: true }).setSystemTime(new Date(Date.UTC(2026, 0, 1, 12, 0, 0))));
  afterAll(() => jest.useRealTimers());

  const morador: JwtPayload = { sub: 5, nome: 'Morador X', typeAccess: 'Morador' };
  const sindico: JwtPayload = { sub: 1, nome: 'Síndico', id_condominio: 2, typeAccess: 'Sindico' };

  function reserva(overrides: Partial<any> = {}) {
    return {
      id: 500,
      id_user: 5,
      id_area_social: 30,
      id_apartamento: 100,
      status: 'pendente',
      data: new Date(2026, 5, 10),
      hora_de: new Date(1970, 0, 1, 10, 0, 0),
      hora_ate: new Date(1970, 0, 1, 12, 0, 0),
      area: { id_condominio: 2, nome: 'Salão' },
      user: { id: 5, fcm_token: 'token-do-morador' },
      ...overrides,
    };
  }

  function build(linha: any) {
    const r = { ...linha };
    const prisma: any = {
      isConnected: true,
      areas_Sociais_Agendamentos: {
        findUnique: jest.fn(async () => ({ ...r })),
        findMany: jest.fn(async () => []),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (where.status !== r.status) return { count: 0 };
          Object.assign(r, data);
          return { count: 1 };
        }),
      },
      apartamentos_Users: { findFirst: jest.fn(async () => ({ id_apto: 100 })) },
      sindicos_Condominios: { findFirst: jest.fn(async () => ({ id: 1 })) },
      funcionarios: {
        findFirst: jest.fn(async ({ where }: any) => (Number(where?.id_condominio) === 2 ? { areas_sociais: 1 } : null)),
      },
    };
    const notifications: any = { sendPushNotification: jest.fn().mockResolvedValue({}) };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const facial: any = { syncReservaArea: jest.fn().mockResolvedValue({}) };
    const svc = new AreasSociaisService(prisma, notifications, storage, facial, new TenantAccessService(prisma));
    return { svc, notifications, linha: r };
  }

  it('morador cancela a própria reserva → sendPushNotification não é chamado', async () => {
    const { svc, notifications, linha } = build(reserva({ status: 'aprovado' }));
    await svc.updateStatusAgendamento(500, 'cancelado', '', morador);
    expect(linha.status).toBe('cancelado');
    expect(notifications.sendPushNotification).not.toHaveBeenCalled();
  });

  it("síndico aprova reserva do morador → push enviado ao morador com type 'reserva_status'", async () => {
    const { svc, notifications, linha } = build(reserva({ status: 'pendente' }));
    await svc.updateStatusAgendamento(500, true, '', sindico);
    expect(linha.status).toBe('aprovado');
    expect(notifications.sendPushNotification).toHaveBeenCalledTimes(1);
    expect(notifications.sendPushNotification).toHaveBeenCalledWith(
      'token-do-morador',
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ type: 'reserva_status', id: '500', status: 'aprovado', id_condominio: '2' }),
    );
  });

  it('síndico cancela reserva do morador → push enviado', async () => {
    const { svc, notifications, linha } = build(reserva({ status: 'aprovado' }));
    await svc.updateStatusAgendamento(500, 'cancelado', '', sindico);
    expect(linha.status).toBe('cancelado');
    expect(notifications.sendPushNotification).toHaveBeenCalledTimes(1);
    expect(notifications.sendPushNotification).toHaveBeenCalledWith(
      'token-do-morador',
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ type: 'reserva_status', id: '500', status: 'cancelado' }),
    );
  });
});
