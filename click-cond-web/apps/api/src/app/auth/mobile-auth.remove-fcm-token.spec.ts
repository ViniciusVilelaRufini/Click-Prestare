import { MobileAuthService } from './mobile-auth.service';

/**
 * F4: sair da conta em um aparelho apagava o push dos outros.
 *
 * `removeFcmToken` anulava `Users.fcm_token` sempre (é o token que quase todo
 * ponto de envio lê), fechava os cards ao vivo de todos os aparelhos e, sem
 * token no corpo, apagava todos os `Users_Devices` do usuário. O iPhone que
 * continuava logado ficava mudo até reabrir o app.
 */
describe('MobileAuthService.removeFcmToken — só o aparelho que saiu', () => {
  function build(opts: {
    devices: Array<{ id: number; id_user: number; fcm_token: string; updated_at: Date }>;
    users: Array<{ id: number; fcm_token: string | null }>;
  }) {
    const devices = opts.devices.map((d) => ({ ...d }));
    const users = opts.users.map((u) => ({ ...u }));
    const casa = (row: any, where: any) =>
      Object.entries(where ?? {}).every(([k, v]) => {
        if (v && typeof v === 'object' && 'not' in (v as any)) return row[k] !== (v as any).not;
        return row[k] === v;
      });
    const prisma: any = {
      isConnected: true,
      users_Devices: {
        deleteMany: jest.fn(async ({ where }: any) => {
          const antes = devices.length;
          for (let i = devices.length - 1; i >= 0; i--) if (casa(devices[i], where)) devices.splice(i, 1);
          return { count: antes - devices.length };
        }),
        findFirst: jest.fn(async ({ where, orderBy }: any) => {
          const lista = devices.filter((d) => casa(d, where));
          if (orderBy) {
            lista.sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime() || b.id - a.id);
          }
          return lista[0] ?? null;
        }),
      },
      users: {
        updateMany: jest.fn(async ({ where, data }: any) => {
          let count = 0;
          for (const u of users) if (casa(u, where)) { Object.assign(u, data); count++; }
          return { count };
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const u = users.find((x) => x.id === where.id)!;
          Object.assign(u, data);
          return u;
        }),
      },
    };
    const card = {
      encerrarDoUsuario: jest.fn(async () => undefined),
      encerrarDoToken: jest.fn(async () => undefined),
      encerrarDoAparelho: jest.fn(async () => undefined),
    };
    const svc = new MobileAuthService(
      prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      undefined, card as any,
    );
    return { svc, prisma, card, devices, users };
  }

  const t = (iso: string) => new Date(iso);

  it('o aparelho que NÃO é o Users.fcm_token sai sem tirar o push do outro', async () => {
    const { svc, devices, users, card } = build({
      devices: [
        { id: 1, id_user: 7, fcm_token: 'fcm-android', updated_at: t('2026-11-20T10:00:00Z') },
        { id: 2, id_user: 7, fcm_token: 'fcm-iphone', updated_at: t('2026-11-24T10:00:00Z') },
      ],
      users: [{ id: 7, fcm_token: 'fcm-iphone' }],
    });
    await svc.removeFcmToken(7, 'fcm-android');
    expect(users[0].fcm_token).toBe('fcm-iphone');
    expect(devices.map((d) => d.fcm_token)).toEqual(['fcm-iphone']);
    expect(card.encerrarDoAparelho).toHaveBeenCalledWith(7, 'fcm-android');
    expect(card.encerrarDoUsuario).not.toHaveBeenCalled();
  });

  it('o aparelho que É o Users.fcm_token sai: o outro aparelho mais recente assume', async () => {
    const { svc, devices, users } = build({
      devices: [
        { id: 1, id_user: 7, fcm_token: 'fcm-velho', updated_at: t('2026-10-01T10:00:00Z') },
        { id: 2, id_user: 7, fcm_token: 'fcm-android', updated_at: t('2026-11-22T10:00:00Z') },
        { id: 3, id_user: 7, fcm_token: 'fcm-iphone', updated_at: t('2026-11-24T10:00:00Z') },
      ],
      users: [{ id: 7, fcm_token: 'fcm-iphone' }],
    });
    await svc.removeFcmToken(7, 'fcm-iphone');
    expect(users[0].fcm_token).toBe('fcm-android');
    expect(devices.map((d) => d.fcm_token).sort()).toEqual(['fcm-android', 'fcm-velho']);
  });

  it('o último aparelho sai: Users.fcm_token fica nulo', async () => {
    const { svc, devices, users } = build({
      devices: [{ id: 1, id_user: 7, fcm_token: 'fcm-iphone', updated_at: t('2026-11-24T10:00:00Z') }],
      users: [{ id: 7, fcm_token: 'fcm-iphone' }],
    });
    await svc.removeFcmToken(7, 'fcm-iphone');
    expect(users[0].fcm_token).toBeNull();
    expect(devices).toEqual([]);
  });

  it('sem token no corpo: não apaga aparelho nenhum, não anula o token nem fecha cards', async () => {
    const { svc, devices, users, card, prisma } = build({
      devices: [
        { id: 1, id_user: 7, fcm_token: 'fcm-android', updated_at: t('2026-11-20T10:00:00Z') },
        { id: 2, id_user: 7, fcm_token: 'fcm-iphone', updated_at: t('2026-11-24T10:00:00Z') },
      ],
      users: [{ id: 7, fcm_token: 'fcm-iphone' }],
    });
    await expect(svc.removeFcmToken(7, undefined)).resolves.toEqual({ success: true });
    expect(devices).toHaveLength(2);
    expect(users[0].fcm_token).toBe('fcm-iphone');
    expect(prisma.users_Devices.deleteMany).not.toHaveBeenCalled();
    expect(card.encerrarDoUsuario).not.toHaveBeenCalled();
    expect(card.encerrarDoAparelho).not.toHaveBeenCalled();
  });

  it('token de outro usuário no corpo não mexe nos aparelhos dele', async () => {
    const { svc, devices, users } = build({
      devices: [
        { id: 1, id_user: 7, fcm_token: 'fcm-meu', updated_at: t('2026-11-20T10:00:00Z') },
        { id: 2, id_user: 9, fcm_token: 'fcm-vizinho', updated_at: t('2026-11-24T10:00:00Z') },
      ],
      users: [{ id: 7, fcm_token: 'fcm-meu' }, { id: 9, fcm_token: 'fcm-vizinho' }],
    });
    await svc.removeFcmToken(7, 'fcm-vizinho');
    expect(devices).toHaveLength(2);
    expect(users.find((u) => u.id === 9)!.fcm_token).toBe('fcm-vizinho');
    expect(users.find((u) => u.id === 7)!.fcm_token).toBe('fcm-meu');
  });
});
