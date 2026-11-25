import { NotificationsService } from './notifications.service';

/**
 * O push saía para UM aparelho só.
 *
 * Os ~20 pontos de envio do sistema passam `Users.fcm_token`, que guarda um
 * token por usuário. Quem tinha dois celulares na mesma conta recebia apenas
 * no último que abriu o app — foi assim que o iPhone ficou mudo enquanto o
 * Android recebia. O fan-out passou a acontecer aqui dentro, sem tocar nos
 * chamadores.
 */
const enviados: string[] = [];
let erroAoEnviar: any = null;
/** Quando preenchido, só este token falha com `erroAoEnviar`. */
let tokenComErro: string | null = null;

jest.mock('firebase-admin', () => ({
  messaging: () => ({
    send: jest.fn(async (msg: any) => {
      if (erroAoEnviar && (!tokenComErro || msg.token === tokenComErro)) throw erroAoEnviar;
      enviados.push(msg.token);
      return `id-${msg.token}`;
    }),
  }),
  credential: { cert: jest.fn() },
  initializeApp: jest.fn(),
}));

describe('NotificationsService — envio para todos os aparelhos do usuário', () => {
  function build(devices: Array<{ id_user: number; fcm_token: string }>) {
    const prisma: any = {
      isConnected: true,
      users_Devices: {
        findUnique: jest.fn(async ({ where }: any) =>
          devices.find((d) => d.fcm_token === where.fcm_token) ?? null,
        ),
        findMany: jest.fn(async ({ where }: any) =>
          devices.filter((d) => d.id_user === where.id_user),
        ),
        deleteMany: jest.fn(async () => ({ count: 1 })),
      },
      users: {
        findUnique: jest.fn(async ({ where }: any) => ({
          fcm_token: devices.find((d) => d.id_user === where.id)?.fcm_token ?? null,
        })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    };
    const svc = new NotificationsService(prisma);
    (svc as any).enabled = true;
    return { svc, prisma };
  }

  beforeEach(() => {
    enviados.length = 0;
    erroAoEnviar = null;
    tokenComErro = null;
  });

  it('entrega nos DOIS aparelhos do mesmo usuário', async () => {
    const { svc } = build([
      { id_user: 47, fcm_token: 'token-android' },
      { id_user: 47, fcm_token: 'token-iphone' },
    ]);

    await svc.sendPushNotification('token-android', 'Visita', 'Chegou alguém');

    expect(enviados.sort()).toEqual(['token-android', 'token-iphone']);
  });

  it('não vaza para aparelho de outro usuário', async () => {
    const { svc } = build([
      { id_user: 47, fcm_token: 'meu-celular' },
      { id_user: 99, fcm_token: 'celular-do-vizinho' },
    ]);

    await svc.sendPushNotification('meu-celular', 'Encomenda', 'Chegou');

    expect(enviados).toEqual(['meu-celular']);
  });

  // Aparelho que ainda não reabriu o app desde a migração não está na tabela.
  // Nesse caso o envio tem que continuar acontecendo — nunca menos do que o
  // comportamento anterior.
  it('token desconhecido ainda recebe', async () => {
    const { svc } = build([]);
    await svc.sendPushNotification('token-orfao', 'Aviso', 'Teste');
    expect(enviados).toEqual(['token-orfao']);
  });

  it('token recusado pelo FCM sai da tabela', async () => {
    const { svc, prisma } = build([{ id_user: 47, fcm_token: 'token-morto' }]);
    erroAoEnviar = Object.assign(new Error('not registered'), {
      errorInfo: { code: 'messaging/registration-token-not-registered' },
    });

    await svc.sendPushNotification('token-morto', 'Aviso', 'Teste');

    expect(prisma.users_Devices.deleteMany).toHaveBeenCalledWith({
      where: { fcm_token: 'token-morto' },
    });
  });

  // Uma falha de rede não pode custar a limpeza indevida do aparelho: só
  // token que o FCM diz não conhecer é removido.
  it('falha genérica não remove o aparelho', async () => {
    const { svc, prisma } = build([{ id_user: 47, fcm_token: 'token-ok' }]);
    erroAoEnviar = Object.assign(new Error('timeout'), {
      errorInfo: { code: 'messaging/server-unavailable' },
    });

    await svc.sendPushNotification('token-ok', 'Aviso', 'Teste');

    expect(prisma.users_Devices.deleteMany).not.toHaveBeenCalled();
  });
});

/**
 * F4: com `Users.fcm_token` nulo (logout de outro aparelho no código antigo,
 * ou token morto que era o principal), o envio apagava TODOS os aparelhos do
 * usuário, inclusive os que continuavam logados.
 */
describe('NotificationsService — Users.fcm_token nulo não apaga aparelho válido', () => {
  function build(
    devices: Array<{ id: number; id_user: number; fcm_token: string; updated_at: Date }>,
    users: Array<{ id: number; fcm_token: string | null }>,
  ) {
    const casa = (row: any, where: any) =>
      Object.entries(where ?? {}).every(([k, v]) => row[k] === v);
    const prisma: any = {
      isConnected: true,
      users_Devices: {
        findUnique: jest.fn(async ({ where }: any) => devices.find((d) => d.fcm_token === where.fcm_token) ?? null),
        findMany: jest.fn(async ({ where }: any) => devices.filter((d) => d.id_user === where.id_user)),
        findFirst: jest.fn(async ({ where }: any) =>
          devices
            .filter((d) => casa(d, where))
            .sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime() || b.id - a.id)[0] ?? null,
        ),
        deleteMany: jest.fn(async ({ where }: any) => {
          const antes = devices.length;
          for (let i = devices.length - 1; i >= 0; i--) if (casa(devices[i], where)) devices.splice(i, 1);
          return { count: antes - devices.length };
        }),
      },
      users: {
        findUnique: jest.fn(async ({ where }: any) => users.find((u) => u.id === where.id) ?? null),
        updateMany: jest.fn(async ({ where, data }: any) => {
          let count = 0;
          for (const u of users) if (casa(u, where)) { Object.assign(u, data); count++; }
          return { count };
        }),
      },
    };
    const svc = new NotificationsService(prisma);
    (svc as any).enabled = true;
    return { svc, prisma, devices, users };
  }

  beforeEach(() => {
    enviados.length = 0;
    erroAoEnviar = null;
    tokenComErro = null;
  });

  it('aparelho registrado de usuário com Users.fcm_token nulo: recebe, e o mais recente vira o principal', async () => {
    const { svc, devices, users } = build(
      [
        { id: 1, id_user: 47, fcm_token: 'token-android', updated_at: new Date('2026-11-20T10:00:00Z') },
        { id: 2, id_user: 47, fcm_token: 'token-iphone', updated_at: new Date('2026-11-24T10:00:00Z') },
      ],
      [{ id: 47, fcm_token: null }],
    );
    await svc.sendPushNotification('token-android', 'Aviso', 'Teste');
    expect(devices).toHaveLength(2);
    expect(enviados.sort()).toEqual(['token-android', 'token-iphone']);
    expect(users[0].fcm_token).toBe('token-iphone');
  });

  it('token principal recusado pelo FCM: sai só ele, e o outro aparelho assume', async () => {
    const { svc, devices, users } = build(
      [
        { id: 1, id_user: 47, fcm_token: 'token-morto', updated_at: new Date('2026-11-24T10:00:00Z') },
        { id: 2, id_user: 47, fcm_token: 'token-vivo', updated_at: new Date('2026-11-20T10:00:00Z') },
      ],
      [{ id: 47, fcm_token: 'token-morto' }],
    );
    erroAoEnviar = Object.assign(new Error('not registered'), {
      errorInfo: { code: 'messaging/registration-token-not-registered' },
    });
    tokenComErro = 'token-morto';
    await svc.sendPushNotification('token-morto', 'Aviso', 'Teste');
    expect(devices.map((d) => d.fcm_token)).toEqual(['token-vivo']);
    expect(users[0].fcm_token).toBe('token-vivo');
  });
});
