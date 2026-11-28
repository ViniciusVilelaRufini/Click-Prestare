import { InterfonePushService } from './interfone-push.service';

type U = { id: number; fcm_token: string | null; interfone_receber: number };
type D = { id: number; id_user: number; fcm_token: string; plataforma: string | null; voip_token: string | null; interfone_versao: number };

function montar(usuarios: U[], aparelhos: D[]) {
  const prisma: any = {
    users: {
      findMany: jest.fn(async ({ where }: any) =>
        usuarios.filter(
          (u) =>
            where.id.in.includes(u.id) &&
            (where.interfone_receber === undefined || u.interfone_receber === where.interfone_receber),
        ),
      ),
    },
    users_Devices: {
      findMany: jest.fn(async ({ where }: any) => aparelhos.filter((a) => where.id_user.in.includes(a.id_user))),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
  };
  const notifications = {
    enviarDados: jest.fn(async () => 'ok' as const),
    enviarParaAparelho: jest.fn(async () => ({})),
  };
  const svc = new InterfonePushService(prisma, notifications as any);
  const apns = { enviar: jest.fn(async () => ({ status: 200 })) };
  svc.apns = apns;
  svc.agora = () => 1_800_000_000_000;
  return { svc, prisma, notifications, apns };
}

const DADOS = { tipo: 'facial_unidade', unidade: 'Bloco A · Apto 106', portao: 'Portão social', condominio: 'Residencial Teste' };

describe('InterfonePushService.tocar', () => {
  const usuarios: U[] = [
    { id: 1, fcm_token: 'f-ios', interfone_receber: 1 },
    { id: 2, fcm_token: 'f-and1', interfone_receber: 1 },
    { id: 3, fcm_token: 'f-and0', interfone_receber: 1 },
  ];
  const aparelhos: D[] = [
    { id: 11, id_user: 1, fcm_token: 'f-ios', plataforma: 'iOS', voip_token: 'voip-1', interfone_versao: 1 },
    { id: 12, id_user: 2, fcm_token: 'f-and1', plataforma: 'android', voip_token: null, interfone_versao: 1 },
    { id: 13, id_user: 3, fcm_token: 'f-and0', plataforma: 'android', voip_token: null, interfone_versao: 0 },
  ];

  it('iOS v1 com voip → VoIP; Android v1 → dados; Android v0 → push comum', async () => {
    const { svc, notifications, apns } = montar(usuarios, aparelhos);
    const r = await svc.tocar(42, [1, 2, 3], DADOS);
    expect(r).toEqual({ tocou: 2, semApp: 1 });

    expect(apns.enviar).toHaveBeenCalledTimes(1);
    const [token, corpo, prioridade, opcoes] = (apns.enviar.mock.calls as any[])[0];
    expect(token).toBe('voip-1');
    expect(corpo).toEqual({ aps: {}, type: 'interfone_chamada', id: '42', ...DADOS });
    expect(prioridade).toBe(10);
    expect(opcoes).toMatchObject({ topico: 'br.com.clickprestare.app.voip', tipo: 'voip' });
    expect(opcoes.expiracao).toBe(1_800_000_000 + 60);

    expect(notifications.enviarDados).toHaveBeenCalledTimes(1);
    expect(notifications.enviarDados).toHaveBeenCalledWith('f-and1', { type: 'interfone_chamada', id: '42', ...DADOS });

    expect(notifications.enviarParaAparelho).toHaveBeenCalledTimes(1);
    expect(notifications.enviarParaAparelho).toHaveBeenCalledWith(
      'f-and0',
      'Visitante chamando no portão',
      'Atualize o app para atender pelo celular.',
      { type: 'interfone_perdida', id: '42' },
    );
  });

  it('usuário com interfone_receber=0 não recebe nada', async () => {
    const { svc, notifications, apns } = montar(
      [{ id: 1, fcm_token: 'f-ios', interfone_receber: 0 }, usuarios[1]],
      aparelhos,
    );
    const r = await svc.tocar(42, [1, 2], DADOS);
    expect(r).toEqual({ tocou: 1, semApp: 0 });
    expect(apns.enviar).not.toHaveBeenCalled();
    expect(notifications.enviarDados).toHaveBeenCalledTimes(1);
  });

  it('usuário deslogado (Users.fcm_token null) não recebe nada', async () => {
    const { svc, notifications } = montar([{ id: 2, fcm_token: null, interfone_receber: 1 }], aparelhos);
    expect(await svc.tocar(42, [2], DADOS)).toEqual({ tocou: 0, semApp: 0 });
    expect(notifications.enviarDados).not.toHaveBeenCalled();
  });

  it('envio que falhou não conta como tocou; token VoIP morto sai do aparelho', async () => {
    const { svc, prisma, notifications, apns } = montar(usuarios.slice(0, 2), aparelhos);
    apns.enviar.mockResolvedValueOnce({ status: 410 } as any);
    notifications.enviarDados.mockResolvedValueOnce('falha' as any);
    expect(await svc.tocar(42, [1, 2], DADOS)).toEqual({ tocou: 0, semApp: 0 });
    expect(prisma.users_Devices.updateMany).toHaveBeenCalledWith({
      where: { voip_token: 'voip-1' },
      data: { voip_token: null },
    });
  });

  it('lista vazia não consulta o banco', async () => {
    const { svc, prisma } = montar(usuarios, aparelhos);
    expect(await svc.tocar(42, [], DADOS)).toEqual({ tocou: 0, semApp: 0 });
    expect(prisma.users.findMany).not.toHaveBeenCalled();
  });

  it('aparelho sem registro em Users_Devices usa Users.fcm_token (push comum)', async () => {
    const { svc, notifications } = montar([{ id: 9, fcm_token: 'f-velho', interfone_receber: 1 }], []);
    expect(await svc.tocar(42, [9], DADOS)).toEqual({ tocou: 0, semApp: 1 });
    expect(notifications.enviarParaAparelho).toHaveBeenCalledWith('f-velho', expect.any(String), expect.any(String), {
      type: 'interfone_perdida',
      id: '42',
    });
  });
});

describe('InterfonePushService.fim e perdida', () => {
  const usuarios: U[] = [
    { id: 1, fcm_token: 'f-ios', interfone_receber: 1 },
    { id: 2, fcm_token: 'f-and1', interfone_receber: 1 },
  ];
  const aparelhos: D[] = [
    { id: 11, id_user: 1, fcm_token: 'f-ios', plataforma: 'ios', voip_token: 'voip-1', interfone_versao: 1 },
    { id: 12, id_user: 2, fcm_token: 'f-and1', plataforma: 'android', voip_token: null, interfone_versao: 1 },
  ];

  it('fim: dados interfone_fim só no Android; iPhone não recebe nada', async () => {
    const { svc, notifications, apns } = montar(usuarios, aparelhos);
    await svc.fim(42, [1, 2]);
    expect(notifications.enviarDados).toHaveBeenCalledTimes(1);
    expect(notifications.enviarDados).toHaveBeenCalledWith('f-and1', { type: 'interfone_fim', id: '42' });
    expect(apns.enviar).not.toHaveBeenCalled();
    expect(notifications.enviarParaAparelho).not.toHaveBeenCalled();
  });

  it('perdida: push comum com a hora em todos os aparelhos', async () => {
    const { svc, notifications } = montar(usuarios, aparelhos);
    await svc.perdida(42, [1, 2], '14:05');
    expect(notifications.enviarParaAparelho).toHaveBeenCalledTimes(2);
    expect(notifications.enviarParaAparelho).toHaveBeenCalledWith(
      'f-ios',
      'Interfone',
      'Chamada perdida do portão às 14:05',
      { type: 'interfone_perdida', id: '42' },
    );
  });

  it('nunca lança (banco fora)', async () => {
    const { svc, prisma } = montar(usuarios, aparelhos);
    prisma.users.findMany.mockRejectedValue(new Error('banco fora'));
    await expect(svc.tocar(42, [1], DADOS)).resolves.toEqual({ tocou: 0, semApp: 0 });
    await expect(svc.fim(42, [1])).resolves.toBeUndefined();
    await expect(svc.perdida(42, [1], '10:00')).resolves.toBeUndefined();
  });
});
