import { T0, montarCard } from './card-ao-vivo.service.spec';
import { AtendimentoCard } from './delivery-conteudo';

/** Card ao vivo do delivery (spec 2026-11-13-card-ao-vivo-delivery-design.md). */
describe('CardAoVivoService — delivery', () => {
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }));
  afterEach(() => jest.useRealTimers());

  const iphone = { id_user: 1, fcm_token: 'fcm-iphone', plataforma: 'ios', card_token_inicio: 'aa11bb22cc33dd44', card_versao: 2 };
  const android = { id_user: 1, fcm_token: 'fcm-android', plataforma: 'android', card_token_inicio: null, card_android: 1, card_versao: 2 };
  const usuarios = [{ id: 1, fcm_token: 'fcm-iphone', name: 'Marina Souza' }];
  const TOKEN = 'ffee0011ffee0011';

  const a: AtendimentoCard = {
    id: 9,
    status: 'CHEGOU',
    estabelecimento: 'Burger King',
    chegou_em: new Date(T0),
    autorizado_em: null,
    recusado_em: null,
    concluido_em: null,
    motivo: null,
    bloco: 'A',
    apto: '106',
    entregadorNome: 'Carlos',
    entregadorPlataforma: 'iFood',
    fotoEntregador: null,
  };
  const ultimoApns = (apns: any) => (apns.enviar.mock.calls.at(-1) as any[])[1];

  it('abre em chegou: iPhone versão 2 recebe push-to-start de delivery com alerta; Android versão 2 recebe dados', async () => {
    const { svc, apns, notifications, prisma } = montarCard({ aparelhos: [iphone, android], usuarios });
    await svc.abrirDelivery(a, 1);

    const corpo = ultimoApns(apns);
    expect(corpo.aps.event).toBe('start');
    expect(corpo.aps.attributes).toMatchObject({ origem: 'delivery', idPedido: '9' });
    expect(corpo.aps.alert.title).toBe('Delivery na portaria');
    expect(corpo.aps['content-state']).toMatchObject({ fase: 'chegou', nome: 'Burger King', tipo: 'Carlos · iFood' });
    expect(notifications.enviarDados).toHaveBeenCalledWith(
      'fcm-android',
      expect.objectContaining({ type: 'card_portaria', origem: 'delivery', fase: 'chegou', id_pedido: '9' }),
    );
    expect(notifications.enviarParaAparelho).not.toHaveBeenCalled();
    expect(prisma.cards_Ao_Vivo.rows.map((r: any) => [r.origem, r.fase])).toEqual([
      ['delivery', 'chegou'],
      ['delivery', 'chegou'],
    ]);
  });

  it('[RF 2] aparelho com card_versao 1 (app 1.2.42–1.2.45) recebe a notificação de hoje, sem card', async () => {
    const velhos = [
      { ...iphone, card_versao: 1 },
      { ...android, card_versao: undefined },
    ];
    const { svc, apns, notifications, prisma } = montarCard({ aparelhos: velhos, usuarios });
    await svc.abrirDelivery(a, 1);
    expect(apns.enviar).not.toHaveBeenCalled();
    expect(notifications.enviarDados).not.toHaveBeenCalled();
    expect(notifications.enviarParaAparelho).toHaveBeenCalledTimes(2);
    expect(notifications.enviarParaAparelho).toHaveBeenCalledWith(
      'fcm-iphone',
      'Delivery',
      'Seu entregador chegou à portaria.',
      { id_delivery: '9', status: 'CHEGOU' },
    );
    expect(prisma.cards_Ao_Vivo.rows).toHaveLength(0);
  });

  async function abertoEConfirmado(extra: { aparelhos?: any[] } = {}) {
    const k = montarCard({ aparelhos: extra.aparelhos ?? [iphone], usuarios });
    await k.svc.abrirDelivery(a, 1);
    const linha = k.prisma.cards_Ao_Vivo.rows.find((r: any) => r.plataforma === 'ios');
    await k.svc.confirmar(1, linha.id, TOKEN);
    return { ...k, linha };
  }

  it('aguardando toca ("Autorize a entrega"); autorizado atualiza em silêncio', async () => {
    const { svc, apns } = await abertoEConfirmado();
    await svc.atualizarDelivery({ ...a, status: 'AGUARDANDO_AUTORIZACAO' }, 1, { voceRespondeu: false });
    let corpo = ultimoApns(apns);
    expect(corpo.aps.event).toBe('update');
    expect(corpo.aps['content-state'].fase).toBe('aguardando');
    expect(corpo.aps.alert.title).toBe('Autorize a entrega');

    await svc.atualizarDelivery({ ...a, status: 'AUTORIZADA', autorizado_em: new Date(T0 + 60_000) }, 1, { voceRespondeu: true });
    corpo = ultimoApns(apns);
    expect(corpo.aps.event).toBe('update');
    expect(corpo.aps['content-state']).toMatchObject({ fase: 'autorizado', voceRespondeu: true });
    expect(corpo.aps.alert).toBeUndefined();
  });

  it('"vou buscar" do próprio morador leva o card a retirar sem tocar; pela portaria, toca', async () => {
    const meu = await abertoEConfirmado();
    await meu.svc.atualizarDelivery({ ...a, status: 'RETIRADA_NA_PORTARIA' }, 1, { voceRespondeu: true });
    let corpo = ultimoApns(meu.apns);
    expect(corpo.aps['content-state'].fase).toBe('retirar');
    expect(corpo.aps.alert).toBeUndefined();

    const portaria = await abertoEConfirmado();
    await portaria.svc.atualizarDelivery({ ...a, status: 'RETIRADA_NA_PORTARIA' }, 1, { voceRespondeu: false });
    corpo = ultimoApns(portaria.apns);
    expect(corpo.aps.alert.title).toBe('Retire na portaria');
  });

  it('entregue fica 5 min; recusado 2 min; cancelado some na hora', async () => {
    const entregue = await abertoEConfirmado();
    entregue.avancar(60_000);
    await entregue.svc.atualizarDelivery({ ...a, status: 'CONCLUIDA', concluido_em: new Date(T0 + 60_000) }, 1, { voceRespondeu: false });
    let corpo = ultimoApns(entregue.apns);
    expect(corpo.aps.event).toBe('end');
    expect(corpo.aps['dismissal-date']).toBe(corpo.aps.timestamp + 300);
    expect(corpo.aps['content-state'].fase).toBe('entregue');

    const recusado = await abertoEConfirmado();
    await recusado.svc.atualizarDelivery({ ...a, status: 'RECUSADA', motivo: 'Sem documento', recusado_em: new Date(T0) }, 1, { voceRespondeu: false });
    corpo = ultimoApns(recusado.apns);
    expect(corpo.aps.event).toBe('end');
    expect(corpo.aps['dismissal-date']).toBe(corpo.aps.timestamp + 120);
    expect(corpo.aps['content-state'].motivo).toBe('Sem documento');

    const cancelado = await abertoEConfirmado();
    await cancelado.svc.atualizarDelivery({ ...a, status: 'CANCELADA' }, 1, { voceRespondeu: true });
    corpo = ultimoApns(cancelado.apns);
    expect(corpo.aps.event).toBe('end');
    expect(corpo.aps['dismissal-date']).toBe(corpo.aps.timestamp);
    expect(cancelado.prisma.cards_Ao_Vivo.rows.every((r: any) => r.encerrado_em)).toBe(true);
  });

  it('cobertos: só o aparelho com card confirmado e sem reserva', async () => {
    const { svc, avancar } = await abertoEConfirmado({ aparelhos: [iphone, android] });
    avancar(11_000);
    await svc.verificarReserva('delivery', 9);
    const { cobertos } = await svc.atualizarDelivery({ ...a, status: 'AGUARDANDO_AUTORIZACAO' }, 1, { voceRespondeu: false });
    expect([...cobertos]).toEqual(['fcm-iphone']);
  });

  it('Final: sem card aberto, morador respondeu pela tela: reabre dizendo "você" e sem a notificação comum', async () => {
    const velho = { ...iphone, card_versao: 1 };
    const { svc, apns, notifications } = montarCard({ aparelhos: [iphone, { ...velho, fcm_token: 'fcm-velho' }], usuarios });
    const r = await svc.atualizarDelivery({ ...a, status: 'AUTORIZADA', autorizado_em: new Date(T0) }, 1, { voceRespondeu: true });
    expect(r.abriu).toBe(true);
    expect(ultimoApns(apns).aps['content-state']).toMatchObject({ fase: 'autorizado', voceRespondeu: true });
    // O próprio morador agiu: o aparelho sem card não recebe aviso do que ele fez.
    expect(notifications.enviarParaAparelho).not.toHaveBeenCalled();
  });

  it('sem card aberto e status não-final: abre ali', async () => {
    const { svc, apns } = montarCard({ aparelhos: [iphone], usuarios });
    const { cobertos, abriu } = await svc.atualizarDelivery({ ...a, status: 'AGUARDANDO_AUTORIZACAO' }, 1, { voceRespondeu: false });
    expect(abriu).toBe(true);
    expect(cobertos.size).toBe(0);
    const corpo = ultimoApns(apns);
    expect(corpo.aps.event).toBe('start');
    expect(corpo.aps['content-state'].fase).toBe('aguardando');
    expect(corpo.aps.alert.title).toBe('Autorize a entrega');
  });

  it('[RF 1] tique: delivery em aguardando há 11 min não expira; visitante em aguardando há 11 min expira (prazo da API, 10 min)', async () => {
    const aberto = { encerrado_em: null, confirmado_em: new Date(T0), reserva_enviada_em: null, token_atualizacao: null, plataforma: 'android', fcm_token: 'x', id_user: 1 };
    const { svc, prisma } = montarCard({
      cards: [
        { ...aberto, id: 1, origem: 'delivery', id_pedido: 9, fase: 'aguardando', fase_em: new Date(T0 - 660_000), created_at: new Date(T0 - 660_000) },
        { ...aberto, id: 2, origem: 'visitante', id_pedido: 5, fase: 'aguardando', fase_em: new Date(T0 - 660_000), created_at: new Date(T0 - 660_000) },
      ],
    });
    await svc.tick();
    const [delivery, visitante] = prisma.cards_Ao_Vivo.rows;
    expect(delivery.fase).toBe('aguardando');
    expect(delivery.encerrado_em).toBeNull();
    expect(visitante.fase).toBe('expirado');
  });

  it('tique: card de delivery aberto há mais de 2 h é encerrado', async () => {
    const { svc, prisma, notifications } = montarCard({
      cards: [
        {
          id: 1, origem: 'delivery', id_pedido: 9, id_user: 1, plataforma: 'android', fcm_token: 'fcm-android',
          fase: 'autorizado', fase_em: new Date(T0 - 7_260_000), created_at: new Date(T0 - 7_260_000),
          encerrado_em: null, confirmado_em: new Date(T0 - 7_260_000), reserva_enviada_em: null, token_atualizacao: null,
        },
      ],
    });
    await svc.tick();
    expect(prisma.cards_Ao_Vivo.rows[0].encerrado_em).not.toBeNull();
    expect(notifications.enviarDados).toHaveBeenCalledWith('fcm-android', expect.objectContaining({ fase: 'encerrado' }));
  });

  it('[RF 4] foto que passaria de 3900 bytes vai embora; foto pequena vai no estado', async () => {
    const grande = await (async () => {
      const k = montarCard({ aparelhos: [iphone], usuarios });
      jest.spyOn(k.svc, 'fotoDoCard').mockResolvedValue('A'.repeat(3500));
      await k.svc.abrirDelivery({ ...a, fotoEntregador: 'https://bucket/entregadores/1.jpg' }, 1);
      return k;
    })();
    const corpoGrande = ultimoApns(grande.apns);
    expect(corpoGrande.aps['content-state'].foto).toBeUndefined();
    expect(Buffer.byteLength(JSON.stringify(corpoGrande))).toBeLessThanOrEqual(3900);

    const k = montarCard({ aparelhos: [iphone], usuarios });
    jest.spyOn(k.svc, 'fotoDoCard').mockResolvedValue('QUJD');
    await k.svc.abrirDelivery({ ...a, fotoEntregador: 'https://bucket/entregadores/1.jpg' }, 1);
    expect(ultimoApns(k.apns).aps['content-state'].foto).toBe('QUJD');
    expect(ultimoApns(k.apns).aps.attributes.foto).toBeUndefined();
  });

  describe('vários moradores (autoatendimento do portão)', () => {
    const ap7 = { id_user: 7, fcm_token: 'fcm-7', plataforma: 'android', card_token_inicio: null, card_android: 1, card_versao: 2 };
    const ap9 = { id_user: 9, fcm_token: 'fcm-9', plataforma: 'ios', card_token_inicio: 'bb22cc33dd44ee55', card_versao: 2 };
    const dois = [{ id: 7, fcm_token: 'fcm-7' }, { id: 9, fcm_token: 'fcm-9' }];
    const portao: AtendimentoCard = { ...a, status: 'AGUARDANDO_AUTORIZACAO', portao: true };

    it('abrirDelivery com [7, 9] abre nos aparelhos dos dois usuários', async () => {
      const { svc, apns, notifications, prisma } = montarCard({ aparelhos: [ap7, ap9], usuarios: dois });
      await svc.abrirDelivery(portao, [7, 9]);
      expect(prisma.cards_Ao_Vivo.rows.map((r: any) => r.id_user).sort()).toEqual([7, 9]);
      expect(notifications.enviarDados).toHaveBeenCalledWith('fcm-7', expect.objectContaining({ origem: 'delivery', fase: 'aguardando' }));
      const corpo = ultimoApns(apns);
      expect(corpo.aps['content-state']).toMatchObject({ fase: 'aguardando', portao: true });
      expect(corpo.aps.alert).toEqual({ title: 'Entregador no portão', body: 'Carlos · iFood pede para entrar.', sound: 'default' });
    });

    it('abrirDelivery com lista vazia não envia nada', async () => {
      const { svc, apns, notifications, prisma } = montarCard({ aparelhos: [ap7, ap9], usuarios: dois });
      await svc.abrirDelivery(portao, []);
      expect(apns.enviar).not.toHaveBeenCalled();
      expect(notifications.enviarDados).not.toHaveBeenCalled();
      expect(notifications.enviarParaAparelho).not.toHaveBeenCalled();
      expect(prisma.cards_Ao_Vivo.rows).toHaveLength(0);
    });

    it('encerrarDeOutros(delivery, 5, 7) encerra a linha do usuário 9 e mantém a do 7', async () => {
      const { svc, apns, prisma } = montarCard({ aparelhos: [ap7, ap9], usuarios: dois });
      await svc.abrirDelivery({ ...portao, id: 5 }, [7, 9]);
      const linha9 = prisma.cards_Ao_Vivo.rows.find((r: any) => r.id_user === 9);
      await svc.confirmar(9, linha9.id, TOKEN);
      apns.enviar.mockClear();
      await svc.encerrarDeOutros('delivery', 5, 7);
      const [l7, l9] = [7, 9].map((u) => prisma.cards_Ao_Vivo.rows.find((r: any) => r.id_user === u));
      expect(l7.encerrado_em).toBeNull();
      expect(l9.encerrado_em).not.toBeNull();
      const [token, corpo] = apns.enviar.mock.calls[0] as any[];
      expect(token).toBe(TOKEN);
      expect(corpo.aps.event).toBe('end');
      expect(corpo.aps['dismissal-date']).toBe(corpo.aps.timestamp);
    });

    it('atualizarDelivery reabre para a lista inteira quando não há card aberto', async () => {
      const { svc, prisma } = montarCard({ aparelhos: [ap7, ap9], usuarios: dois });
      const r = await svc.atualizarDelivery(portao, [7, 9], { voceRespondeu: false });
      expect(r.abriu).toBe(true);
      expect(prisma.cards_Ao_Vivo.rows.map((x: any) => x.id_user).sort()).toEqual([7, 9]);
    });

    it('atualização do card aberto na fase aguardando do portão toca com o texto do portão', async () => {
      const { svc, apns } = await abertoEConfirmado();
      await svc.atualizarDelivery(portao, 1, { voceRespondeu: false });
      expect(ultimoApns(apns).aps.alert.title).toBe('Entregador no portão');
      expect(ultimoApns(apns).aps['content-state'].portao).toBe(true);
    });
  });

  it('reserva: iPhone que não confirmou em 10 s recebe a notificação de hoje', async () => {
    const { svc, notifications, avancar } = montarCard({ aparelhos: [iphone], usuarios });
    await svc.abrirDelivery(a, 1);
    avancar(11_000);
    await svc.verificarReserva('delivery', 9);
    expect(notifications.enviarParaAparelho).toHaveBeenCalledWith(
      'fcm-iphone',
      'Delivery',
      'Seu entregador chegou à portaria.',
      { id_delivery: '9', status: 'CHEGOU' },
    );
  });

  it('confirmação atrasada depois de mudar de fase reenvia o estado salvo', async () => {
    const { svc, apns, prisma, avancar } = montarCard({ aparelhos: [iphone], usuarios });
    await svc.abrirDelivery(a, 1);
    avancar(2_000);
    await svc.atualizarDelivery({ ...a, status: 'AGUARDANDO_AUTORIZACAO' }, 1, { voceRespondeu: false });
    const linha = prisma.cards_Ao_Vivo.rows[0];
    apns.enviar.mockClear();
    await svc.confirmar(1, linha.id, TOKEN);
    expect(apns.enviar).toHaveBeenCalledTimes(1);
    const [token, corpo] = apns.enviar.mock.calls[0] as any[];
    expect(token).toBe(TOKEN);
    expect(corpo.aps['content-state'].fase).toBe('aguardando');
  });
  it('entregador do portão não esperou: o card em aguardando vai ao estado final "Entregador não esperou" e encerra', async () => {
    const k = await abertoEConfirmado({ aparelhos: [iphone, android] });
    const portao = { ...a, status: 'AGUARDANDO_AUTORIZACAO' as const, portao: true };
    await k.svc.atualizarDelivery(portao, 1, { voceRespondeu: false });
    k.apns.enviar.mockClear();
    k.notifications.enviarDados.mockClear();
    await k.svc.entregadorNaoEsperou(portao);
    const corpo = ultimoApns(k.apns);
    expect(corpo.aps.event).toBe('end');
    expect(corpo.aps['dismissal-date']).toBe(corpo.aps.timestamp + 120);
    expect(corpo.aps['content-state']).toMatchObject({ fase: 'recusado', motivo: 'Entregador não esperou', voceRespondeu: false });
    // Sem os botões do portão.
    expect(corpo.aps['content-state'].portao).toBeUndefined();
    expect(k.notifications.enviarDados).toHaveBeenCalledWith(
      'fcm-android',
      expect.objectContaining({ fase: 'recusado', origem: 'delivery' }),
    );
    expect(k.prisma.cards_Ao_Vivo.rows.every((r: any) => r.encerrado_em)).toBe(true);
    // Segunda chamada (rotina e consulta ao mesmo tempo): nada mais sai.
    k.apns.enviar.mockClear();
    await k.svc.entregadorNaoEsperou(portao);
    expect(k.apns.enviar).not.toHaveBeenCalled();
  });

  it('card já em outra fase (a portaria autorizou) não vira "Entregador não esperou"', async () => {
    const k = await abertoEConfirmado();
    await k.svc.atualizarDelivery({ ...a, status: 'AUTORIZADA', autorizado_em: new Date(T0) }, 1, { voceRespondeu: false });
    k.apns.enviar.mockClear();
    await k.svc.entregadorNaoEsperou({ ...a, status: 'AUTORIZADA' });
    expect(k.apns.enviar).not.toHaveBeenCalled();
    expect(k.prisma.cards_Ao_Vivo.rows[0].fase).toBe('autorizado');
  });
});
