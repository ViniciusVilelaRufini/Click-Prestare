import { T0, montarPortao } from './portao/montar-portao.spec';

/**
 * Rodada 4 — aviso de delivery parado.
 *
 * AGENDADA cujo entregador não chegou vira CANCELADA com motivo "Sem chegada"
 * 24 h depois da previsão (ou da criação, sem previsão), pela rotina periódica
 * do delivery (a mesma do portão, a cada 5 min com lock). Entra na linha do
 * tempo com autor "Sistema" e sem a notificação comum de cancelamento (o card,
 * se houver, só é encerrado). Os demais status NÃO são encerrados aqui — o
 * console só os destaca na fila.
 */
describe('delivery — aviso AGENDADA sem chegada', () => {
  const H = 3_600_000;
  const M = 60_000;
  const em = (ms: number) => new Date(T0 + ms);

  const aviso = (id: number, extra: Record<string, unknown> = {}) => ({
    id,
    id_condominio: 1,
    id_apartamento: 101,
    id_morador_user: 7,
    origem: 'portaria',
    status: 'AGENDADA',
    modo_entrega: 'UNIDADE',
    id_pedido_portao: null,
    previsao_em: null,
    chegou_em: null,
    created_at: em(-H),
    updated_at: em(-H),
    ...extra,
  });

  const status = (k: ReturnType<typeof montarPortao>) =>
    k.tabela('deliveryAtendimentos').map((a: any) => [a.id, a.status, a.motivo ?? null]);

  it('com previsão: cancela 24 h depois dela, não antes', async () => {
    const k = montarPortao({
      atendimentos: [
        aviso(1, { previsao_em: em(-24 * H - M), created_at: em(-30 * H) }),
        aviso(2, { previsao_em: em(-24 * H + M), created_at: em(-30 * H), id_apartamento: 102 }),
        // Criado há muito, mas a previsão ainda não passou: vale a previsão.
        aviso(3, { previsao_em: em(2 * H), created_at: em(-30 * H), id_apartamento: 110 }),
      ],
    });
    await k.svc.tick();
    expect(status(k)).toEqual([
      [1, 'CANCELADA', 'Sem chegada'],
      [2, 'AGENDADA', null],
      [3, 'AGENDADA', null],
    ]);
  });

  it('sem previsão: conta da criação', async () => {
    const k = montarPortao({
      atendimentos: [
        aviso(1, { created_at: em(-24 * H - M) }),
        aviso(2, { created_at: em(-23 * H), id_apartamento: 102 }),
      ],
    });
    await k.svc.tick();
    expect(status(k)).toEqual([
      [1, 'CANCELADA', 'Sem chegada'],
      [2, 'AGENDADA', null],
    ]);
  });

  it('entra na linha do tempo, com autor Sistema, e não manda a notificação de cancelamento', async () => {
    const k = montarPortao({ atendimentos: [aviso(1, { created_at: em(-25 * H) })] });
    await k.svc.tick();
    expect(k.tabela('deliveryEventos')).toEqual([
      expect.objectContaining({
        id_atendimento: 1, status_anterior: 'AGENDADA', status_novo: 'CANCELADA', autor_nome: 'Sistema', mensagem: 'Sem chegada',
      }),
    ]);
    expect(k.tabela('deliveryAtendimentos')[0].cancelado_em).toBeInstanceOf(Date);
    expect(k.notifications.sendPushNotification).not.toHaveBeenCalled();
  });

  it('os demais status parados há dias não são encerrados', async () => {
    const k = montarPortao({
      atendimentos: [
        aviso(1, { status: 'CHEGOU', chegou_em: em(-72 * H), created_at: em(-72 * H), updated_at: em(-72 * H) }),
        aviso(2, { status: 'AGUARDANDO_AUTORIZACAO', chegou_em: em(-72 * H), created_at: em(-72 * H), updated_at: em(-72 * H), id_apartamento: 102 }),
        aviso(3, { status: 'RETIRADA_NA_PORTARIA', chegou_em: em(-72 * H), created_at: em(-72 * H), updated_at: em(-72 * H), id_apartamento: 110 }),
        aviso(4, { status: 'AUTORIZADA', chegou_em: em(-72 * H), created_at: em(-72 * H), updated_at: em(-72 * H), id_apartamento: 201 }),
      ],
    });
    await k.svc.tick();
    expect(status(k).map(([, s]) => s)).toEqual(['CHEGOU', 'AGUARDANDO_AUTORIZACAO', 'RETIRADA_NA_PORTARIA', 'AUTORIZADA']);
  });

  it('aviso que chegou entre a consulta e a gravação não é cancelado', async () => {
    const k = montarPortao({ atendimentos: [aviso(1, { created_at: em(-25 * H) })] });
    const original = k.delivery.transicionarPeloSistema.bind(k.delivery);
    jest.spyOn(k.delivery, 'transicionarPeloSistema').mockImplementation(async (...args) => {
      k.tabela('deliveryAtendimentos')[0].status = 'CHEGOU';
      return original(...args);
    });
    await k.svc.tick();
    expect(k.tabela('deliveryAtendimentos')[0].status).toBe('CHEGOU');
  });
});
