import { PREFIXOS_FOTO_PEDIDO_PORTAO } from '../../common/storage/storage.service';
import { T0, montarPortao } from './montar-portao.spec';

/** Rotina do autoatendimento: expirar, cancelar, concluir e apagar fotos. */
describe('DeliveryPortaoService — rotina', () => {
  const H = 3_600_000;
  const M = 60_000;
  const em = (ms: number) => new Date(T0 + ms);

  const atendimento = (id: number, extra: any = {}) => ({
    id,
    id_condominio: 1,
    id_apartamento: 101,
    id_morador_user: null,
    origem: 'autoatendimento',
    status: 'AGUARDANDO_AUTORIZACAO',
    modo_entrega: 'UNIDADE',
    id_pedido_portao: null,
    chegou_em: em(-10 * M),
    created_at: em(-10 * M),
    updated_at: em(-10 * M),
    ...extra,
  });
  const pedido = (id: number, idAtendimento: number, extra: any = {}) => ({
    id,
    id_atendimento: idAtendimento,
    id_device: 30,
    nome: 'Carlos',
    plataforma: null,
    foto: `https://bucket.s3.amazonaws.com/delivery-portao/${id}.jpg`,
    token_hash: String(id).padStart(64, '0'),
    status: 'pendente',
    criado_em: em(-M),
    expira_em: em(4 * M),
    visto_em: null,
    liberado_ate: null,
    aberto_em: null,
    saida_aberta_em: null,
    falha_abertura_em: null,
    ...extra,
  });

  it('pedido pendente vencido vira expirado; o não vencido fica', async () => {
    const { svc, tabela } = montarPortao({
      atendimentos: [atendimento(1), atendimento(2, { id_apartamento: 102 })],
      pedidos: [pedido(10, 1, { expira_em: em(-1000) }), pedido(11, 2, { expira_em: em(60_000) })],
    });
    await svc.tick();
    expect(tabela('deliveryPedidosPortao').map((p) => [p.id, p.status])).toEqual([
      [10, 'expirado'],
      [11, 'pendente'],
    ]);
  });

  it('autoatendimento sem resposta 2h01 depois do pedido é cancelado com "Sem resposta do morador"; 1h59 não', async () => {
    const { svc, tabela } = montarPortao({
      atendimentos: [
        atendimento(1, { id_pedido_portao: 10 }),
        atendimento(2, { id_pedido_portao: 11, id_apartamento: 102 }),
        atendimento(3, { status: 'CHEGOU', id_pedido_portao: 12, id_apartamento: 110 }),
      ],
      pedidos: [
        pedido(10, 1, { status: 'expirado', criado_em: em(-2 * H - M), expira_em: em(-2 * H + 4 * M) }),
        pedido(11, 2, { status: 'expirado', criado_em: em(-2 * H + M), expira_em: em(-2 * H + 6 * M) }),
        pedido(12, 3, { status: 'expirado', criado_em: em(-2 * H - M), expira_em: em(-2 * H + 4 * M) }),
      ],
    });
    await svc.tick();
    const [a1, a2, a3] = tabela('deliveryAtendimentos');
    expect(a1).toMatchObject({ status: 'CANCELADA', motivo: 'Sem resposta do morador' });
    expect(a2.status).toBe('AGUARDANDO_AUTORIZACAO');
    expect(a3).toMatchObject({ status: 'CANCELADA', motivo: 'Sem resposta do morador' });
    expect(tabela('deliveryEventos').filter((e) => e.status_novo === 'CANCELADA').map((e) => e.autor_nome)).toEqual(['Sistema', 'Sistema']);
  });

  it('as 2 h contam do criado_em do pedido de portão, não do chegou_em do atendimento', async () => {
    const { svc, tabela } = montarPortao({
      atendimentos: [
        // Chegou há 3 h, mas o pedido é de 1 h atrás: fica.
        atendimento(1, { chegou_em: em(-3 * H), id_pedido_portao: 10 }),
        // Chegou há 10 min (relógio do atendimento), mas o pedido é de 2h01: cancela.
        atendimento(2, { chegou_em: em(-10 * M), id_pedido_portao: 11, id_apartamento: 102 }),
        // Sem pedido de portão: a rotina não tem de onde contar.
        atendimento(3, { chegou_em: em(-5 * H), id_apartamento: 110 }),
      ],
      pedidos: [
        pedido(10, 1, { status: 'expirado', criado_em: em(-H), expira_em: em(-H + 5 * M) }),
        pedido(11, 2, { status: 'expirado', criado_em: em(-2 * H - M), expira_em: em(-2 * H + 4 * M) }),
      ],
    });
    await svc.tick();
    expect(tabela('deliveryAtendimentos').map((a) => a.status)).toEqual(['AGUARDANDO_AUTORIZACAO', 'CANCELADA', 'AGUARDANDO_AUTORIZACAO']);
  });

  it('aviso AGENDADA/CHEGOU de origem portaria nunca é cancelado pela rotina', async () => {
    const { svc, tabela } = montarPortao({
      atendimentos: [
        atendimento(1, { origem: 'portaria', id_morador_user: 7, status: 'AGENDADA', chegou_em: null, created_at: em(-5 * H) }),
        atendimento(2, { origem: 'portaria', id_morador_user: 7, status: 'CHEGOU', chegou_em: em(-5 * H) }),
        atendimento(3, { origem: 'portaria', id_morador_user: 7, status: 'AGUARDANDO_AUTORIZACAO', chegou_em: em(-5 * H) }),
      ],
    });
    await svc.tick();
    expect(tabela('deliveryAtendimentos').map((a) => a.status)).toEqual(['AGENDADA', 'CHEGOU', 'AGUARDANDO_AUTORIZACAO']);
  });

  it('atendimento aberto há 31 min é concluído; há 29 min não', async () => {
    const { svc, tabela } = montarPortao({
      atendimentos: [
        atendimento(1, { status: 'AUTORIZADA', id_pedido_portao: 10, id_morador_user: 7 }),
        atendimento(2, { status: 'AUTORIZADA', id_pedido_portao: 11, id_morador_user: 7, id_apartamento: 102 }),
        // Aviso do morador reaproveitado pelo portão também conclui.
        atendimento(3, { status: 'AUTORIZADA', id_pedido_portao: 12, id_morador_user: 7, origem: 'portaria', id_apartamento: 110 }),
      ],
      pedidos: [
        pedido(10, 1, { status: 'liberado', aberto_em: em(-31 * M) }),
        pedido(11, 2, { status: 'liberado', aberto_em: em(-29 * M) }),
        pedido(12, 3, { status: 'liberado', aberto_em: em(-40 * M) }),
      ],
    });
    await svc.tick();
    const [a1, a2, a3] = tabela('deliveryAtendimentos');
    expect(a1.status).toBe('CONCLUIDA');
    expect(a2.status).toBe('AUTORIZADA');
    expect(a3.status).toBe('CONCLUIDA');
    expect(tabela('deliveryEventos').find((e) => e.id_atendimento === 1)).toMatchObject({
      status_novo: 'CONCLUIDA',
      autor_nome: 'Sistema',
      mensagem: 'Concluído automaticamente após a entrada',
    });
  });

  it('autoatendimento AUTORIZADA sem abertura e RETIRADA_NA_PORTARIA há 2h01 são encerrados sem retirada (CANCELADA, nunca concluídos) e avisam o morador', async () => {
    const { svc, tabela } = montarPortao({
      atendimentos: [
        atendimento(1, { status: 'AUTORIZADA', id_pedido_portao: 10, updated_at: em(-2 * H - M) }),
        atendimento(2, { status: 'RETIRADA_NA_PORTARIA', id_pedido_portao: 11, updated_at: em(-2 * H - M), id_apartamento: 102 }),
        atendimento(3, { status: 'AUTORIZADA', id_pedido_portao: 12, updated_at: em(-2 * H + M), id_apartamento: 110 }),
        // Origem portaria: quem conclui é a portaria.
        atendimento(4, { status: 'AUTORIZADA', origem: 'portaria', id_morador_user: 7, updated_at: em(-5 * H), id_apartamento: 201 }),
      ],
      pedidos: [
        pedido(10, 1, { status: 'expirado' }),
        pedido(11, 2, { status: 'vou_buscar' }),
        pedido(12, 3, { status: 'liberado' }),
      ],
    });
    await svc.tick();
    expect(tabela('deliveryAtendimentos').map((a) => a.status)).toEqual(['CANCELADA', 'CANCELADA', 'AUTORIZADA', 'AUTORIZADA']);
    expect(tabela('deliveryEventos').filter((e) => e.status_novo === 'CANCELADA').map((e) => e.mensagem)).toEqual([
      'Encerrada sem retirada',
      'Encerrada sem retirada',
    ]);
    expect(tabela('deliveryEventos').some((e) => e.status_novo === 'CONCLUIDA')).toBe(false);
  });

  it('um erro num atendimento não impede os seguintes', async () => {
    const k = montarPortao({
      atendimentos: [
        atendimento(1, { chegou_em: em(-3 * H), id_pedido_portao: 10 }),
        atendimento(2, { chegou_em: em(-3 * H), id_pedido_portao: 11, id_apartamento: 102 }),
        atendimento(3, { status: 'RETIRADA_NA_PORTARIA', updated_at: em(-3 * H), id_apartamento: 110, id_pedido_portao: 12 }),
      ],
      pedidos: [
        pedido(10, 1, { status: 'expirado', criado_em: em(-3 * H), expira_em: em(-3 * H + 5 * M) }),
        pedido(11, 2, { status: 'expirado', criado_em: em(-3 * H), expira_em: em(-3 * H + 5 * M) }),
        pedido(12, 3, { status: 'vou_buscar', criado_em: em(-3 * H), expira_em: em(-3 * H + 5 * M) }),
      ],
    });
    const original = k.delivery.transicionarPeloSistema.bind(k.delivery);
    jest.spyOn(k.delivery, 'transicionarPeloSistema').mockImplementation(async (id, s, m) => {
      if (id === 1) throw new Error('banco piscou');
      return original(id, s, m);
    });
    await expect(k.svc.tick()).resolves.toBeUndefined();
    expect(k.tabela('deliveryAtendimentos').map((a) => a.status)).toEqual(['AGUARDANDO_AUTORIZACAO', 'CANCELADA', 'CANCELADA']);
  });

  it('erro numa etapa não impede as outras', async () => {
    const k = montarPortao({
      atendimentos: [atendimento(1, { chegou_em: em(-3 * H), id_pedido_portao: 10 })],
      pedidos: [pedido(10, 1, { criado_em: em(-3 * H), expira_em: em(-1000) })],
    });
    k.banco.prisma.deliveryPedidosPortao.updateMany.mockRejectedValueOnce(new Error('timeout'));
    await k.svc.tick();
    expect(k.tabela('deliveryAtendimentos')[0].status).toBe('CANCELADA');
  });

  it('tickFotos apaga só dentro de delivery-portao/, zera a coluna e segue após falha de um arquivo', async () => {
    const velho = em(-91 * 24 * H);
    const { svc, tabela, storage } = montarPortao({
      pedidos: [
        pedido(1, 99, { criado_em: velho, status: 'expirado' }),
        pedido(2, 99, { criado_em: velho, status: 'expirado' }),
        pedido(3, 99, { criado_em: velho, status: 'expirado' }),
        pedido(4, 99, { criado_em: em(-89 * 24 * H), status: 'expirado' }),
        pedido(5, 99, { criado_em: velho, status: 'expirado', foto: null }),
      ],
    });
    storage.deleteUrl.mockImplementation(async (url: string) => {
      if (url.endsWith('/2.jpg')) throw new Error('S3 fora');
      return true;
    });
    expect(await svc.tickFotos()).toBe(2);
    for (const c of storage.deleteUrl.mock.calls) expect(c[1]).toBe(PREFIXOS_FOTO_PEDIDO_PORTAO);
    expect(PREFIXOS_FOTO_PEDIDO_PORTAO).toEqual(['delivery-portao/']);
    expect(storage.deleteUrl).toHaveBeenCalledTimes(3);
    expect(tabela('deliveryPedidosPortao').map((p) => [p.id, p.foto === null])).toEqual([
      [1, true],
      [2, false],
      [3, true],
      [4, false],
      [5, true],
    ]);
  });

  it('tickFotos percorre em lotes de 500', async () => {
    const velho = em(-100 * 24 * H);
    const pedidos = Array.from({ length: 1001 }, (_, i) => pedido(i + 1, 99, { criado_em: velho, status: 'expirado' }));
    const { svc, tabela, banco } = montarPortao({ pedidos });
    expect(await svc.tickFotos()).toBe(1001);
    expect(tabela('deliveryPedidosPortao').every((p) => p.foto === null)).toBe(true);
    const lotes = banco.prisma.deliveryPedidosPortao.findMany.mock.calls.map((c: any[]) => c[0].take);
    expect(lotes.every((t: number) => t === 500)).toBe(true);
  });

  // J6: o pedido vence em 5 min, mas a rotina rodava a cada 5 min — o morador
  // via AGUARDANDO com botões por até 10 min. O vencimento tem agora um tick
  // próprio de 1 min (barato: índice status+expira_em, lote de 200).
  it('J6: fora de teste, o vencimento dos pedidos tem tick próprio de no máximo 1 min', async () => {
    const pedidos = [pedido(1, 99, { criado_em: em(-6 * M), expira_em: em(-30_000) })];
    const { svc, tabela } = montarPortao({ atendimentos: [atendimento(99, { id_pedido_portao: 1 })], pedidos });
    const nodeEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    const espiao = jest.spyOn(global, 'setInterval');
    try {
      svc.onModuleInit();
      const curtos = espiao.mock.calls.filter((c) => Number(c[1]) <= 60_000);
      expect(curtos).toHaveLength(1);
      // O tick curto vence o pedido vencido.
      (curtos[0][0] as () => void)();
      await new Promise((r) => setTimeout(r, 50));
      expect(tabela('deliveryPedidosPortao').find((p: any) => p.id === 1).status).toBe('expirado');
    } finally {
      espiao.mockRestore();
      svc.onModuleDestroy();
      process.env['NODE_ENV'] = nodeEnv;
    }
  });

  it('em teste a rotina não agenda nada', () => {
    const { svc } = montarPortao();
    const espiao = jest.spyOn(global, 'setInterval');
    svc.onModuleInit();
    expect(espiao).not.toHaveBeenCalled();
    espiao.mockRestore();
    svc.onModuleDestroy();
  });
});
