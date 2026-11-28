import { INTERFONE_VERSAO_APP, INTERFONE_VERSAO_PEDIDO, InterfonePushService } from './interfone-push.service';

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
    expect(r).toEqual({ tocou: 2, semApp: 1, ids: [1, 2] });

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
    expect(r).toEqual({ tocou: 1, semApp: 0, ids: [2] });
    expect(apns.enviar).not.toHaveBeenCalled();
    expect(notifications.enviarDados).toHaveBeenCalledTimes(1);
  });

  it('usuário deslogado (Users.fcm_token null) não recebe nada', async () => {
    const { svc, notifications } = montar([{ id: 2, fcm_token: null, interfone_receber: 1 }], aparelhos);
    expect(await svc.tocar(42, [2], DADOS)).toEqual({ tocou: 0, semApp: 0, ids: [] });
    expect(notifications.enviarDados).not.toHaveBeenCalled();
  });

  it('envio que falhou não conta como tocou; token VoIP morto sai do aparelho', async () => {
    const { svc, prisma, notifications, apns } = montar(usuarios.slice(0, 2), aparelhos);
    apns.enviar.mockResolvedValueOnce({ status: 410 } as any);
    notifications.enviarDados.mockResolvedValueOnce('falha' as any);
    expect(await svc.tocar(42, [1, 2], DADOS)).toEqual({ tocou: 0, semApp: 0, ids: [] });
    expect(prisma.users_Devices.updateMany).toHaveBeenCalledWith({
      where: { voip_token: 'voip-1' },
      data: { voip_token: null },
    });
  });

  it('app antigo quando quem liga é a portaria: texto da portaria', async () => {
    const { svc, notifications } = montar(usuarios, aparelhos);
    await svc.tocar(42, [3], { ...DADOS, tipo: 'portaria_unidade', portao: 'Portaria' });
    expect(notifications.enviarParaAparelho).toHaveBeenCalledWith(
      'f-and0',
      'A portaria está chamando',
      'Atualize o app para atender pelo celular.',
      { type: 'interfone_perdida', id: '42' },
    );
  });

  it('iPhone com app novo sem voip_token: alerta "Toque para atender" com os dados da chamada; conta como tocou', async () => {
    const { svc, notifications, apns } = montar(
      [{ id: 4, fcm_token: 'f-ios-sem', interfone_receber: 1 }],
      [{ id: 14, id_user: 4, fcm_token: 'f-ios-sem', plataforma: 'iOS', voip_token: null, interfone_versao: 1 }],
    );
    (notifications.enviarParaAparelho as jest.Mock).mockResolvedValue('msg-id' as any);
    await expect(svc.tocar(42, [4], DADOS)).resolves.toEqual({ tocou: 1, semApp: 0, ids: [4] });
    expect(apns.enviar).not.toHaveBeenCalled();
    expect(notifications.enviarParaAparelho).toHaveBeenCalledWith('f-ios-sem', 'Visitante chamando no portão', 'Toque para atender.', {
      type: 'interfone_chamada',
      id: '42',
      ...DADOS,
    });
    await svc.tocar(43, [4], { ...DADOS, tipo: 'portaria_unidade', portao: 'Portaria' });
    expect(notifications.enviarParaAparelho).toHaveBeenLastCalledWith(
      'f-ios-sem',
      'A portaria está chamando',
      'Toque para atender.',
      expect.objectContaining({ type: 'interfone_chamada', id: '43', tipo: 'portaria_unidade' }),
    );
  });

  it('alerta do iPhone sem voip_token que não saiu não conta como tocou', async () => {
    const { svc, notifications } = montar(
      [{ id: 4, fcm_token: 'f-ios-sem', interfone_receber: 1 }],
      [{ id: 14, id_user: 4, fcm_token: 'f-ios-sem', plataforma: 'ios', voip_token: null, interfone_versao: 1 }],
    );
    (notifications.enviarParaAparelho as jest.Mock).mockResolvedValue(null as any);
    await expect(svc.tocar(42, [4], DADOS)).resolves.toEqual({ tocou: 0, semApp: 0, ids: [] });
  });

  it('podemTocar: só quem tem aparelho com interfone novo (iPhone com ou sem voip_token)', async () => {
    const { svc } = montar(
      [...usuarios, { id: 4, fcm_token: 'f-ios-sem', interfone_receber: 1 }, { id: 5, fcm_token: 'f5', interfone_receber: 0 }],
      [
        ...aparelhos,
        { id: 14, id_user: 4, fcm_token: 'f-ios-sem', plataforma: 'ios', voip_token: null, interfone_versao: 1 },
        { id: 15, id_user: 5, fcm_token: 'f5', plataforma: 'android', voip_token: null, interfone_versao: 1 },
      ],
    );
    await expect(svc.podemTocar([1, 2, 3, 4, 5])).resolves.toEqual([1, 2, 4]);
  });

  it('lista vazia não consulta o banco', async () => {
    const { svc, prisma } = montar(usuarios, aparelhos);
    expect(await svc.tocar(42, [], DADOS)).toEqual({ tocou: 0, semApp: 0, ids: [] });
    expect(prisma.users.findMany).not.toHaveBeenCalled();
  });

  it('aparelho sem registro em Users_Devices usa Users.fcm_token (push comum)', async () => {
    const { svc, notifications } = montar([{ id: 9, fcm_token: 'f-velho', interfone_receber: 1 }], []);
    expect(await svc.tocar(42, [9], DADOS)).toEqual({ tocou: 0, semApp: 1, ids: [] });
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
    await expect(svc.tocar(42, [1], DADOS)).resolves.toEqual({ tocou: 0, semApp: 0, ids: [] });
    await expect(svc.fim(42, [1])).resolves.toBeUndefined();
    await expect(svc.perdida(42, [1], '10:00')).resolves.toBeUndefined();
  });
});

describe('InterfonePushService.pedido e pedidoFim (pedido do portão)', () => {
  const usuarios: U[] = [
    { id: 1, fcm_token: 'f-ios', interfone_receber: 1 },
    { id: 2, fcm_token: 'f-and2', interfone_receber: 1 },
    { id: 3, fcm_token: 'f-and0', interfone_receber: 1 },
    { id: 4, fcm_token: 'f-desligou', interfone_receber: 0 },
    { id: 5, fcm_token: 'f-and1', interfone_receber: 1 },
    { id: 6, fcm_token: 'f-ios1', interfone_receber: 1 },
  ];
  const aparelhos: D[] = [
    { id: 11, id_user: 1, fcm_token: 'f-ios', plataforma: 'iOS', voip_token: 'voip-1', interfone_versao: 2 },
    { id: 12, id_user: 2, fcm_token: 'f-and2', plataforma: 'android', voip_token: null, interfone_versao: 2 },
    { id: 13, id_user: 3, fcm_token: 'f-and0', plataforma: 'android', voip_token: null, interfone_versao: 0 },
    { id: 14, id_user: 4, fcm_token: 'f-desligou', plataforma: 'android', voip_token: null, interfone_versao: 2 },
    { id: 15, id_user: 5, fcm_token: 'f-and1', plataforma: 'android', voip_token: null, interfone_versao: 1 },
    { id: 16, id_user: 6, fcm_token: 'f-ios1', plataforma: 'ios', voip_token: 'voip-6', interfone_versao: 1 },
  ];
  const PEDIDO = {
    id_chamada: 42,
    unidade: 'Bloco A · Apto 106',
    condominio: 'Residencial Teste',
    portao: 'Portão social',
    nome: 'Rodrigo',
    motivo: null,
    tipo: 'entrega',
    foto_url: 'https://foto?assinada=1',
  };
  const CONTEUDO = {
    type: 'interfone_pedido',
    id: '77',
    id_chamada: '42',
    unidade: 'Bloco A · Apto 106',
    condominio: 'Residencial Teste',
    portao: 'Portão social',
    nome: 'Rodrigo',
    motivo: '',
    tipo: 'entrega',
    foto_url: 'https://foto?assinada=1',
  };
  const ALERTA_ANTIGO = 'Visitante no portão: Rodrigo. Atualize o app Prestare para responder.';

  it('INTERFONE_VERSAO_PEDIDO é 2 e o toque das chamadas continua exigindo só a 1', () => {
    expect(INTERFONE_VERSAO_PEDIDO).toBe(2);
    expect(INTERFONE_VERSAO_APP).toBe(1);
  });

  it('app com a tela do pedido (v2): Android → dados interfone_pedido em texto; iPhone → alerta com os mesmos dados; nunca VoIP', async () => {
    const { svc, notifications, apns } = montar(usuarios, aparelhos);
    const r = await svc.pedido(77, [1, 2, 3, 4, 5, 6], PEDIDO);
    expect(apns.enviar).not.toHaveBeenCalled();
    expect(notifications.enviarDados).toHaveBeenCalledTimes(1);
    expect(notifications.enviarDados).toHaveBeenCalledWith('f-and2', CONTEUDO);
    for (const v of Object.values((notifications.enviarDados.mock.calls as any[])[0][1])) expect(typeof v).toBe('string');
    expect(notifications.enviarParaAparelho).toHaveBeenCalledWith('f-ios', 'Entrega no portão', 'Rodrigo pede para entrar. Toque para responder.', CONTEUDO);
    // interfone_receber = 0 não recebe.
    const tokens = [...(notifications.enviarDados.mock.calls as any[]), ...(notifications.enviarParaAparelho.mock.calls as any[])].map((c) => c[0]);
    expect(tokens).not.toContain('f-desligou');
    expect(r.ids).toEqual([1, 2]);
  });

  it('app sem a tela do pedido (v1, e o sem interfone): alerta comum "Atualize o app", sem tipo especial; alcance conta os dois grupos', async () => {
    const { svc, notifications } = montar(usuarios, aparelhos);
    const r = await svc.pedido(77, [1, 2, 3, 4, 5, 6], PEDIDO);
    for (const token of ['f-and1', 'f-ios1', 'f-and0']) {
      expect(notifications.enviarParaAparelho).toHaveBeenCalledWith(token, 'Interfone', ALERTA_ANTIGO);
    }
    const doV1 = (notifications.enviarParaAparelho.mock.calls as any[]).filter((c) => c[0] === 'f-and1');
    expect(doV1).toHaveLength(1);
    expect(doV1[0]).toHaveLength(3);
    expect(notifications.enviarDados).not.toHaveBeenCalledWith('f-and1', expect.anything());
    expect(r.alcance).toEqual({ apps: 2, antigos: 3 });
  });

  it('alcance conta só os envios que saíram', async () => {
    const { svc, notifications } = montar(usuarios, aparelhos);
    notifications.enviarDados.mockResolvedValueOnce('falha' as any);
    (notifications.enviarParaAparelho as jest.Mock).mockImplementation(async (token: string) => (token === 'f-and1' ? null : {}));
    const r = await svc.pedido(77, [1, 2, 3, 5, 6], PEDIDO);
    expect(r).toEqual({ ids: [1], alcance: { apps: 1, antigos: 2 } });
  });

  it('título pelo tipo e motivo no texto quando há', async () => {
    const { svc, notifications } = montar(usuarios.slice(0, 1), aparelhos);
    await svc.pedido(77, [1], { ...PEDIDO, tipo: 'visita', motivo: 'Aniversário' });
    expect(notifications.enviarParaAparelho).toHaveBeenLastCalledWith(
      'f-ios',
      'Visita no portão',
      'Rodrigo pede para entrar (Aniversário). Toque para responder.',
      expect.objectContaining({ type: 'interfone_pedido', motivo: 'Aniversário', tipo: 'visita' }),
    );
    await svc.pedido(78, [1], { ...PEDIDO, tipo: 'servico' });
    expect(notifications.enviarParaAparelho).toHaveBeenLastCalledWith('f-ios', 'Prestador no portão', expect.any(String), expect.anything());
    await svc.pedido(79, [1], { ...PEDIDO, tipo: 'outro', foto_url: null });
    expect(notifications.enviarParaAparelho).toHaveBeenLastCalledWith(
      'f-ios',
      'Pedido no portão',
      expect.any(String),
      expect.objectContaining({ foto_url: '' }),
    );
  });

  it('pedidoFim: dados interfone_pedido_fim só nos aparelhos com a tela do pedido (v2, Android e iPhone)', async () => {
    const { svc, notifications, apns } = montar(usuarios, aparelhos);
    await svc.pedidoFim(77, [1, 2, 3, 5, 6]);
    expect(notifications.enviarDados).toHaveBeenCalledTimes(2);
    expect(notifications.enviarDados).toHaveBeenCalledWith('f-ios', { type: 'interfone_pedido_fim', id: '77' });
    expect(notifications.enviarDados).toHaveBeenCalledWith('f-and2', { type: 'interfone_pedido_fim', id: '77' });
    expect(apns.enviar).not.toHaveBeenCalled();
    expect(notifications.enviarParaAparelho).not.toHaveBeenCalled();
  });

  it('regressão: aparelhos com interfone v1 e v2 continuam tocando nas chamadas (o v2 do pedido não muda o toque)', async () => {
    const { svc, notifications, apns } = montar(usuarios, aparelhos);
    const r = await svc.tocar(42, [1, 2, 5, 6], DADOS);
    expect(r).toEqual({ tocou: 4, semApp: 0, ids: [1, 2, 5, 6] });
    expect(apns.enviar).toHaveBeenCalledTimes(2);
    expect((apns.enviar.mock.calls as any[]).map((c) => c[0]).sort()).toEqual(['voip-1', 'voip-6']);
    expect(notifications.enviarDados).toHaveBeenCalledWith('f-and1', expect.objectContaining({ type: 'interfone_chamada' }));
    expect(notifications.enviarDados).toHaveBeenCalledWith('f-and2', expect.objectContaining({ type: 'interfone_chamada' }));
    await expect(svc.podemTocar([1, 2, 5, 6])).resolves.toEqual([1, 2, 5, 6]);
    notifications.enviarDados.mockClear();
    await svc.fim(42, [2, 5]);
    expect((notifications.enviarDados.mock.calls as any[]).map((c) => c[0]).sort()).toEqual(['f-and1', 'f-and2']);
  });

  it('nunca lança (banco fora)', async () => {
    const { svc, prisma } = montar(usuarios, aparelhos);
    prisma.users.findMany.mockRejectedValue(new Error('banco fora'));
    await expect(svc.pedido(77, [1], PEDIDO)).resolves.toEqual({ ids: [], alcance: { apps: 0, antigos: 0 } });
    await expect(svc.pedidoFim(77, [1])).resolves.toBeUndefined();
  });
});
