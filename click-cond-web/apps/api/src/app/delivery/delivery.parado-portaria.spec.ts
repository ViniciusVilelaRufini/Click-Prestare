import { T0, montarPortao } from './portao/montar-portao.spec';
import {
  MOTIVO_PARADO_SEM_RESPOSTA,
  MSG_ENCERRADO_AUTOMATICAMENTE,
  PARADO_PORTARIA_MS,
} from './delivery.service';

/**
 * Atendimento da portaria (sem pedido de portão) parado há 24 h é encerrado
 * pela rotina periódica do delivery: AUTORIZADA/RETIRADA_NA_PORTARIA →
 * CANCELADA ("Encerrada sem retirada"); CHEGOU/AGUARDANDO_AUTORIZACAO →
 * CANCELADA com motivo "Sem resposta". Com pedido de portão valem as regras
 * de 2 h do portão; AGENDADA segue a regra "Sem chegada".
 */
describe('delivery — atendimento da portaria parado há 24 h', () => {
  const H = 3_600_000;
  const em = (ms: number) => new Date(T0 + ms);

  const atendimento = (id: number, status: string, paradoMs: number, extra: Record<string, unknown> = {}) => ({
    id,
    id_condominio: 1,
    id_apartamento: 101,
    id_morador_user: 7,
    origem: 'portaria',
    status,
    modo_entrega: 'UNIDADE',
    id_pedido_portao: null,
    previsao_em: null,
    chegou_em: em(-paradoMs),
    created_at: em(-paradoMs),
    updated_at: em(-paradoMs),
    ...extra,
  });

  const status = (k: ReturnType<typeof montarPortao>) =>
    k.tabela('deliveryAtendimentos').map((a: any) => [a.id, a.status, a.motivo ?? null]);

  it('constantes', () => {
    expect(PARADO_PORTARIA_MS).toBe(24 * 3_600_000);
    expect(MOTIVO_PARADO_SEM_RESPOSTA).toBe('Sem resposta');
    expect(MSG_ENCERRADO_AUTOMATICAMENTE).toBe('Encerrado automaticamente');
  });

  it("RETIRADA_NA_PORTARIA sem pedido, parado 25 h → CANCELADA com 'Encerrada sem retirada'", async () => {
    const k = montarPortao({ atendimentos: [atendimento(1, 'RETIRADA_NA_PORTARIA', 25 * H)] });
    const n = await k.delivery.encerrarParadosDaPortaria();
    expect(n).toBe(1);
    const [a] = k.tabela('deliveryAtendimentos');
    expect(a.status).toBe('CANCELADA');
    expect(a.concluido_em ?? null).toBeNull();
    expect(a.cancelado_em).toBeInstanceOf(Date);
    expect(k.tabela('deliveryEventos')).toEqual([
      expect.objectContaining({
        id_atendimento: 1,
        status_anterior: 'RETIRADA_NA_PORTARIA',
        status_novo: 'CANCELADA',
        autor_nome: 'Sistema',
        mensagem: 'Encerrada sem retirada',
      }),
    ]);
  });

  it('AUTORIZADA sem pedido (entregador subiu), parado 25 h → CONCLUIDA como antes, sem "sem retirada"', async () => {
    const k = montarPortao({ atendimentos: [atendimento(1, 'AUTORIZADA', 25 * H)] });
    await k.delivery.encerrarParadosDaPortaria();
    expect(status(k)).toEqual([[1, 'CONCLUIDA', null]]);
    expect(k.tabela('deliveryEventos')[0]).toMatchObject({ status_novo: 'CONCLUIDA', mensagem: 'Encerrado automaticamente' });
  });

  // O aviso da rotina vai em segundo plano (semEsperarAviso): deixa assentar.
  const assentar = async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  };

  it('encerramento automático (sem retirada) de 24 h não manda a notificação comum ao morador, mas o card chega ao fim', async () => {
    const k = montarPortao({
      atendimentos: [
        atendimento(1, 'AUTORIZADA', 25 * H),
        atendimento(2, 'RETIRADA_NA_PORTARIA', 25 * H),
      ],
    });
    const n = await k.delivery.encerrarParadosDaPortaria();
    await assentar();
    expect(n).toBe(2);
    expect(k.notifications.sendPushNotification).not.toHaveBeenCalled();
    expect(k.card.atualizarDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, status: 'CONCLUIDA' }),
      7,
      { voceRespondeu: false },
    );
    expect(k.card.atualizarDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ id: 2, status: 'CANCELADA' }),
      7,
      { voceRespondeu: false },
    );
  });

  it('outros chamadores de transicionarPeloSistema seguem mandando a notificação comum de CONCLUIDA', async () => {
    const k = montarPortao({ atendimentos: [atendimento(1, 'AUTORIZADA', 1 * H)] });
    expect(await k.delivery.transicionarPeloSistema(1, 'CONCLUIDA', 'Concluído na saída do entregador')).toBe(true);
    expect(k.notifications.sendPushNotification).toHaveBeenCalledWith(
      'fcm-7',
      'Delivery',
      expect.any(String),
      { type: 'delivery', id_delivery: '1', status: 'CONCLUIDA', id_condominio: '1' },
    );
  });

  it('encerrada sem retirada (rotina do portão, 2 h) avisa o morador sem dizer "concluída" nem "cancelada pela portaria"', async () => {
    const k = montarPortao({ atendimentos: [atendimento(1, 'AUTORIZADA', 3 * H)] });
    expect(
      await k.delivery.transicionarPeloSistema(1, 'CANCELADA', 'Encerrada sem retirada', { encerrarSemRetirada: true }),
    ).toBe(true);
    expect(k.notifications.sendPushNotification).toHaveBeenCalledWith(
      'fcm-7',
      'Delivery',
      'Sua entrega foi encerrada sem retirada.',
      expect.objectContaining({ status: 'CANCELADA' }),
    );
  });

  it('cancelamento do sistema por outro motivo segue sem a notificação comum', async () => {
    const k = montarPortao({ atendimentos: [atendimento(1, 'CHEGOU', 3 * H)] });
    expect(await k.delivery.transicionarPeloSistema(1, 'CANCELADA', 'Sem resposta')).toBe(true);
    expect(k.notifications.sendPushNotification).not.toHaveBeenCalled();
  });

  it("CHEGOU e AGUARDANDO_AUTORIZACAO sem pedido, parados 25 h → CANCELADA com motivo 'Sem resposta'", async () => {
    const k = montarPortao({
      atendimentos: [
        atendimento(1, 'CHEGOU', 25 * H),
        atendimento(2, 'AGUARDANDO_AUTORIZACAO', 25 * H, { id_apartamento: 102 }),
      ],
    });
    const n = await k.delivery.encerrarParadosDaPortaria();
    expect(n).toBe(2);
    expect(status(k)).toEqual([
      [1, 'CANCELADA', 'Sem resposta'],
      [2, 'CANCELADA', 'Sem resposta'],
    ]);
    expect(k.tabela('deliveryAtendimentos').every((a: any) => a.cancelado_em instanceof Date)).toBe(true);
  });

  it('parado 23 h → nada muda', async () => {
    const k = montarPortao({
      atendimentos: [
        atendimento(1, 'CHEGOU', 23 * H),
        atendimento(2, 'AGUARDANDO_AUTORIZACAO', 23 * H, { id_apartamento: 102 }),
        atendimento(3, 'AUTORIZADA', 23 * H, { id_apartamento: 110 }),
        atendimento(4, 'RETIRADA_NA_PORTARIA', 23 * H, { id_apartamento: 201 }),
      ],
    });
    const n = await k.delivery.encerrarParadosDaPortaria();
    expect(n).toBe(0);
    expect(status(k).map(([, s]) => s)).toEqual(['CHEGOU', 'AGUARDANDO_AUTORIZACAO', 'AUTORIZADA', 'RETIRADA_NA_PORTARIA']);
  });

  it('com id_pedido_portao → nada muda', async () => {
    const k = montarPortao({
      atendimentos: [
        atendimento(1, 'CHEGOU', 25 * H, { id_pedido_portao: 500 }),
        atendimento(2, 'AGUARDANDO_AUTORIZACAO', 25 * H, { id_pedido_portao: 501, id_apartamento: 102 }),
        atendimento(3, 'AUTORIZADA', 25 * H, { id_pedido_portao: 502, id_apartamento: 110 }),
        atendimento(4, 'RETIRADA_NA_PORTARIA', 25 * H, { id_pedido_portao: 503, id_apartamento: 201 }),
      ],
    });
    const n = await k.delivery.encerrarParadosDaPortaria();
    expect(n).toBe(0);
    expect(status(k).map(([, s]) => s)).toEqual(['CHEGOU', 'AGUARDANDO_AUTORIZACAO', 'AUTORIZADA', 'RETIRADA_NA_PORTARIA']);
  });

  it('AGENDADA → nada muda', async () => {
    // Previsão no futuro: a regra "Sem chegada" também não a pega.
    const k = montarPortao({ atendimentos: [atendimento(1, 'AGENDADA', 25 * H, { chegou_em: null, previsao_em: em(2 * H) })] });
    const n = await k.delivery.encerrarParadosDaPortaria();
    expect(n).toBe(0);
    expect(status(k)).toEqual([[1, 'AGENDADA', null]]);
  });

  it('um atendimento que falha não impede os outros', async () => {
    const k = montarPortao({
      atendimentos: [
        atendimento(1, 'CHEGOU', 25 * H),
        atendimento(2, 'RETIRADA_NA_PORTARIA', 25 * H, { id_apartamento: 102 }),
      ],
    });
    const original = k.delivery.transicionarPeloSistema.bind(k.delivery);
    jest
      .spyOn(k.delivery, 'transicionarPeloSistema')
      .mockImplementationOnce(async () => {
        throw new Error('banco caiu');
      })
      .mockImplementation(original);
    const n = await k.delivery.encerrarParadosDaPortaria();
    expect(n).toBe(1);
    expect(status(k)).toEqual([
      [1, 'CHEGOU', null],
      [2, 'CANCELADA', 'Encerrada sem retirada'],
    ]);
    expect((k.delivery as any).logger.warn).toHaveBeenCalled();
  });

  it('a rotina periódica (tick) encerra os parados da portaria', async () => {
    const k = montarPortao({
      atendimentos: [
        atendimento(1, 'CHEGOU', 25 * H),
        atendimento(2, 'AUTORIZADA', 25 * H, { id_apartamento: 102 }),
      ],
    });
    await k.svc.tick();
    expect(status(k)).toEqual([
      [1, 'CANCELADA', 'Sem resposta'],
      [2, 'CONCLUIDA', null],
    ]);
  });

  it('I1: sem a opção encerrarSemRetirada, AUTORIZADA/RETIRADA não vira CANCELADA pelo sistema', async () => {
    const k = montarPortao({
      atendimentos: [atendimento(1, 'AUTORIZADA', 3 * H), atendimento(2, 'RETIRADA_NA_PORTARIA', 3 * H, { id_apartamento: 102 })],
    });
    expect(await k.delivery.transicionarPeloSistema(1, 'CANCELADA', 'Sem resposta')).toBe(false);
    expect(await k.delivery.transicionarPeloSistema(2, 'CANCELADA', 'Sem resposta')).toBe(false);
    expect(status(k).map(([, s]) => s)).toEqual(['AUTORIZADA', 'RETIRADA_NA_PORTARIA']);
  });

  it('I1: corrida — morador autoriza entre a consulta e a transição: o "sem resposta" não cancela', async () => {
    const k = montarPortao({ atendimentos: [atendimento(1, 'AGUARDANDO_AUTORIZACAO', 3 * H)] });
    const db = (k.delivery as any).prisma.deliveryAtendimentos;
    const find = db.findUnique.bind(db);
    // A leitura da transição já enxerga a autorização do morador.
    jest.spyOn(db, 'findUnique').mockImplementationOnce(async (a: any) => ({ ...(await find(a)), status: 'AUTORIZADA' }));
    const ok = await k.delivery.transicionarPeloSistema(1, 'CANCELADA', 'Sem resposta', {
      somenteDe: ['CHEGOU', 'AGUARDANDO_AUTORIZACAO'],
    });
    expect(ok).toBe(false);
    expect(k.tabela('deliveryEventos')).toEqual([]);
  });
});
