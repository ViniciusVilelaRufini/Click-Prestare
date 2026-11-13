import { MobileAuthService } from './mobile-auth.service';

/** Card ao vivo: token de push-to-start do iPhone e logout. */
describe('MobileAuthService — card ao vivo', () => {
  function build() {
    const prisma: any = {
      isConnected: true,
      users_Devices: {
        upsert: jest.fn(async () => ({})),
        deleteMany: jest.fn(async () => ({ count: 0 })),
      },
      users: {
        updateMany: jest.fn(async () => ({ count: 0 })),
        update: jest.fn(async () => ({})),
      },
    };
    const card = { encerrarDoUsuario: jest.fn(async () => undefined) };
    const svc = new MobileAuthService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      undefined,
      card as any,
    );
    return { svc, prisma, card };
  }

  it('grava o token de abertura do card no aparelho', async () => {
    const { svc, prisma } = build();
    await svc.updateFcmToken(1, 'fcm-x', 'iOS', 'abc123abc123abc123');
    const args = prisma.users_Devices.upsert.mock.calls[0][0];
    expect(args.create.card_token_inicio).toBe('abc123abc123abc123');
    expect(args.update.card_token_inicio).toBe('abc123abc123abc123');
  });

  it('app antigo (sem o campo) não apaga o token já gravado', async () => {
    const { svc, prisma } = build();
    await svc.updateFcmToken(1, 'fcm-x', 'iOS');
    const args = prisma.users_Devices.upsert.mock.calls[0][0];
    expect('card_token_inicio' in args.update).toBe(false);
  });

  it('string vazia ou lixo zera o token (aparelho deixou de ter card)', async () => {
    const { svc, prisma } = build();
    await svc.updateFcmToken(1, 'fcm-x', 'iOS', '');
    expect(prisma.users_Devices.upsert.mock.calls[0][0].update.card_token_inicio).toBeNull();
    await svc.updateFcmToken(1, 'fcm-x', 'iOS', 'nao-hex!');
    expect(prisma.users_Devices.upsert.mock.calls[1][0].update.card_token_inicio).toBeNull();
  });

  it('grava o tema do app; app antigo ou valor inválido não mexe no tema gravado', async () => {
    const { svc, prisma } = build();
    await svc.updateFcmToken(1, 'fcm-x', 'iOS', undefined, false, 'claro');
    let args = prisma.users_Devices.upsert.mock.calls[0][0];
    expect(args.create.card_tema).toBe('claro');
    expect(args.update.card_tema).toBe('claro');

    await svc.updateFcmToken(1, 'fcm-x', 'iOS');
    args = prisma.users_Devices.upsert.mock.calls[1][0];
    expect('card_tema' in args.update).toBe(false);

    await svc.updateFcmToken(1, 'fcm-x', 'iOS', undefined, false, 'roxo');
    args = prisma.users_Devices.upsert.mock.calls[2][0];
    expect('card_tema' in args.update).toBe(false);
  });

  it('grava card_versao 2 do app novo; ausente ou inválido não mexe', async () => {
    const { svc, prisma } = build();
    await svc.updateFcmToken(1, 'fcm-x', 'iOS', undefined, false, undefined, 2);
    let args = prisma.users_Devices.upsert.mock.calls[0][0];
    expect(args.create.card_versao).toBe(2);
    expect(args.update.card_versao).toBe(2);

    await svc.updateFcmToken(1, 'fcm-x', 'iOS');
    expect('card_versao' in prisma.users_Devices.upsert.mock.calls[1][0].update).toBe(false);

    for (const ruim of [0, 100, '2' as any, 1.5]) {
      prisma.users_Devices.upsert.mockClear();
      await svc.updateFcmToken(1, 'fcm-x', 'iOS', undefined, false, undefined, ruim);
      args = prisma.users_Devices.upsert.mock.calls[0][0];
      expect('card_versao' in args.update).toBe(false);
      expect('card_versao' in args.create).toBe(false);
    }
  });

  it('logout encerra os cards do usuário antes de apagar os tokens', async () => {
    const { svc, prisma, card } = build();
    await svc.removeFcmToken(1, 'fcm-x');
    expect(card.encerrarDoUsuario).toHaveBeenCalledWith(1);
    expect(card.encerrarDoUsuario.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.users_Devices.deleteMany.mock.invocationCallOrder[0],
    );
  });
});
