import { MobileAuthService } from './mobile-auth.service';

/** Interfone: token VoIP (PushKit) do iPhone e versão do interfone no app. */
describe('MobileAuthService — registro do aparelho para o interfone', () => {
  function build() {
    const prisma: any = {
      isConnected: true,
      users_Devices: {
        upsert: jest.fn(async () => ({})),
        updateMany: jest.fn(async () => ({ count: 0 })),
        deleteMany: jest.fn(async () => ({ count: 0 })),
        findFirst: jest.fn(async () => null),
      },
      users: {
        updateMany: jest.fn(async () => ({ count: 0 })),
        update: jest.fn(async () => ({})),
      },
    };
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
      undefined,
    );
    return { svc, prisma };
  }
  const reg = (svc: MobileAuthService, voip?: any, versao?: any) =>
    svc.updateFcmToken(1, 'fcm-x', 'iOS', undefined, false, undefined, undefined, voip, versao);
  const VOIP = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

  it('grava o voip_token válido (hex 16–200) no create e no update', async () => {
    const { svc, prisma } = build();
    await reg(svc, VOIP);
    const args = prisma.users_Devices.upsert.mock.calls[0][0];
    expect(args.create.voip_token).toBe(VOIP);
    expect(args.update.voip_token).toBe(VOIP);
  });

  it('app sem o campo não mexe no voip_token gravado', async () => {
    const { svc, prisma } = build();
    await reg(svc);
    const args = prisma.users_Devices.upsert.mock.calls[0][0];
    expect('voip_token' in args.update).toBe(false);
    expect('voip_token' in args.create).toBe(false);
  });

  it('string vazia ou lixo zera o voip_token', async () => {
    const { svc, prisma } = build();
    await reg(svc, '');
    expect(prisma.users_Devices.upsert.mock.calls[0][0].update.voip_token).toBeNull();
    await reg(svc, 'nao-hex!');
    expect(prisma.users_Devices.upsert.mock.calls[1][0].update.voip_token).toBeNull();
    await reg(svc, 'ab'.repeat(101));
    expect(prisma.users_Devices.upsert.mock.calls[2][0].update.voip_token).toBeNull();
  });

  it('o mesmo voip_token sai de outros registros (o iPhone não toca para a conta antiga)', async () => {
    const { svc, prisma } = build();
    await reg(svc, VOIP);
    expect(prisma.users_Devices.updateMany).toHaveBeenCalledWith({
      where: { voip_token: VOIP, fcm_token: { not: 'fcm-x' } },
      data: { voip_token: null },
    });
  });

  it('grava interfone_versao inteiro 0–99; ausente ou inválido não mexe', async () => {
    const { svc, prisma } = build();
    await reg(svc, undefined, 1);
    let args = prisma.users_Devices.upsert.mock.calls[0][0];
    expect(args.create.interfone_versao).toBe(1);
    expect(args.update.interfone_versao).toBe(1);

    prisma.users_Devices.upsert.mockClear();
    await reg(svc, undefined, 0);
    expect(prisma.users_Devices.upsert.mock.calls[0][0].update.interfone_versao).toBe(0);

    for (const ruim of [undefined, -1, 100, '1', 1.5, null]) {
      prisma.users_Devices.upsert.mockClear();
      await reg(svc, undefined, ruim);
      args = prisma.users_Devices.upsert.mock.calls[0][0];
      expect('interfone_versao' in args.update).toBe(false);
      expect('interfone_versao' in args.create).toBe(false);
    }
  });

  it('continua apagando os outros aparelhos do usuário (comportamento de hoje)', async () => {
    const { svc, prisma } = build();
    await reg(svc, VOIP, 1);
    expect(prisma.users_Devices.deleteMany).toHaveBeenCalledWith({
      where: { id_user: 1, fcm_token: { not: 'fcm-x' } },
    });
  });
});
