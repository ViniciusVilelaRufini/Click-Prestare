import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { DeliveryService, GanchoPortao } from './delivery.service';
import { criarBancoFalso } from './portao/banco-falso.spec';

/**
 * DeliveryService aceitando o autoatendimento do portão
 * (spec 2026-11-13-entregador-autoatendimento-portao-design.md).
 */
describe('DeliveryService — autoatendimento no portão', () => {
  const morador7 = { sub: 7, typeAccess: 'Morador', nome: 'Ana Lima' } as any;
  const morador9 = { sub: 9, typeAccess: 'Morador', nome: 'Bruno Reis' } as any;
  const porteiro = { sub: 20, id_condominio: 1, nome: 'Portaria' } as any;
  const AGORA = new Date('2026-11-14T15:00:00Z');

  function montar(extra: { atendimentos?: any[]; pedidos?: any[]; vinculos?: any[] } = {}) {
    const banco = criarBancoFalso(
      {
        condominios: [{ id: 1, nome: 'Residencial Teste' }],
        apartamentos: [
          { id: 101, id_condominio: 1, bloco: 'A', apto: '101' },
          { id: 102, id_condominio: 1, bloco: 'A', apto: '102' },
        ],
        users: [
          { id: 7, name: 'Ana Lima', fcm_token: 'fcm-7' },
          { id: 9, name: 'Bruno Reis', fcm_token: 'fcm-9' },
        ],
        apartamentos_Users: extra.vinculos ?? [
          { id: 1, id_apto: 101, id_user: 7 },
          { id: 2, id_apto: 101, id_user: 9 },
        ],
        facial_Devices: [{ id: 30, id_condominio: 1, nome: 'Portão social', tipo: 'botoeira', ativo: 1 }],
        deliveryAtendimentos: extra.atendimentos ?? [],
        deliveryPedidosPortao: extra.pedidos ?? [],
        deliveryEventos: [],
        deliveryEntregadores: [],
      },
      () => AGORA,
    );
    const notifications: any = { sendPushNotification: jest.fn(async () => undefined) };
    const tenant: any = { assertCondominio: jest.fn(async () => undefined), assertEntidade: jest.fn(async () => undefined) };
    const storage: any = { exigirArquivoDoRegistro: jest.fn(async () => undefined) };
    const card: any = {
      abrirDelivery: jest.fn(async () => undefined),
      atualizarDelivery: jest.fn(async () => ({ cobertos: new Set<string>() })),
      encerrarDeOutros: jest.fn(async () => undefined),
      encerrar: jest.fn(async () => undefined),
    };
    const svc = new DeliveryService(banco.prisma, notifications, tenant, storage, card);
    (svc as any).logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { svc, banco, notifications, card, tabela: banco.tabela };
  }

  const pedidoPendente = (extra: any = {}) => ({
    id: 50,
    id_atendimento: 1,
    id_device: 30,
    nome: 'Carlos',
    plataforma: 'iFood',
    foto: 'https://bucket.s3.amazonaws.com/delivery-portao/1.jpg',
    token_hash: 'h'.repeat(64),
    status: 'pendente',
    criado_em: AGORA,
    expira_em: new Date(AGORA.getTime() + 300_000),
    visto_em: AGORA,
    liberado_ate: null,
    aberto_em: null,
    saida_aberta_em: null,
    falha_abertura_em: null,
    ...extra,
  });

  const atendimentoAuto = (extra: any = {}) => ({
    id: 1,
    id_condominio: 1,
    id_apartamento: 101,
    id_morador_user: null,
    origem: 'autoatendimento',
    status: 'AGUARDANDO_AUTORIZACAO',
    modo_entrega: 'UNIDADE',
    estabelecimento: 'iFood',
    nome_entregador: 'Carlos',
    id_entregador: null,
    id_pedido_portao: 50,
    chegou_em: AGORA,
    created_at: AGORA,
    updated_at: AGORA,
    ...extra,
  });

  it('chegada sem atendimento aberto cria um de origem autoatendimento, sem dono, em AGUARDANDO_AUTORIZACAO, com 2 eventos de autor "Autoatendimento"', async () => {
    const { svc, tabela } = montar();
    const r = await svc.registrarChegadaAutoatendimento({ idCondominio: 1, idApartamento: 101, nomeEntregador: 'Carlos', plataforma: 'iFood' });
    expect(r.criado).toBe(true);
    const [a] = tabela('deliveryAtendimentos');
    expect(a).toMatchObject({
      id: r.id,
      origem: 'autoatendimento',
      id_morador_user: null,
      status: 'AGUARDANDO_AUTORIZACAO',
      modo_entrega: 'UNIDADE',
      estabelecimento: 'iFood',
      nome_entregador: 'Carlos',
    });
    expect(a.chegou_em).toEqual(expect.any(Date));
    const eventos = tabela('deliveryEventos');
    expect(eventos.map((e) => [e.status_anterior, e.status_novo, e.id_usuario_autor, e.autor_nome])).toEqual([
      [null, 'CHEGOU', null, 'Autoatendimento'],
      ['CHEGOU', 'AGUARDANDO_AUTORIZACAO', null, 'Autoatendimento'],
    ]);
  });

  it('chegada reaproveita o aviso AGENDADA do morador e mantém o dono', async () => {
    const aviso = {
      id: 4, id_condominio: 1, id_apartamento: 101, id_morador_user: 7, origem: 'portaria', status: 'AGENDADA',
      estabelecimento: 'Pizzaria', nome_entregador: null, created_at: new Date(AGORA.getTime() - 60_000),
    };
    const { svc, tabela } = montar({ atendimentos: [aviso] });
    const r = await svc.registrarChegadaAutoatendimento({ idCondominio: 1, idApartamento: 101, nomeEntregador: 'Carlos', plataforma: 'iFood' });
    expect(r).toEqual({ id: 4, criado: false, pedido: null });
    const [a] = tabela('deliveryAtendimentos');
    expect(a).toMatchObject({ id_morador_user: 7, origem: 'portaria', status: 'AGUARDANDO_AUTORIZACAO', estabelecimento: 'Pizzaria', nome_entregador: 'Carlos' });
    expect(a.chegou_em).toEqual(expect.any(Date));
    expect(tabela('deliveryEventos').map((e) => e.status_novo)).toEqual(['CHEGOU', 'AGUARDANDO_AUTORIZACAO']);
  });

  it('chegada com a portaria já atendendo a unidade (CHEGOU ou AGUARDANDO_AUTORIZACAO sem pedido de portão): 409 e nada muda', async () => {
    const msg = new ConflictException('A portaria já está atendendo uma entrega para esta unidade. Procure a portaria.');
    for (const status of ['CHEGOU', 'AGUARDANDO_AUTORIZACAO']) {
      const k = montar({ atendimentos: [atendimentoAuto({ status, origem: 'portaria', id_morador_user: 7, nome_entregador: 'Joao', id_pedido_portao: null })] });
      const criarPedido = jest.fn(async () => ({ id: 77 }));
      await expect(
        k.svc.registrarChegadaAutoatendimento({ idCondominio: 1, idApartamento: 101, nomeEntregador: 'Carlos', plataforma: null }, criarPedido),
      ).rejects.toThrow(msg);
      expect(criarPedido).not.toHaveBeenCalled();
      expect(k.tabela('deliveryAtendimentos')).toHaveLength(1);
      expect(k.tabela('deliveryAtendimentos')[0]).toMatchObject({ status, nome_entregador: 'Joao', id_pedido_portao: null });
      expect(k.tabela('deliveryEventos')).toHaveLength(0);
    }
  });

  it('chegada só reaproveita AGENDADA sem pedido de portão anterior', async () => {
    const k = montar({
      atendimentos: [atendimentoAuto({ id: 4, status: 'AGENDADA', origem: 'portaria', id_morador_user: 7, id_pedido_portao: null, chegou_em: null })],
      pedidos: [{ ...pedidoPendente({ id: 49, id_atendimento: 4, status: 'expirado' }) }],
    });
    const r = await k.svc.registrarChegadaAutoatendimento({ idCondominio: 1, idApartamento: 101, nomeEntregador: 'Carlos', plataforma: null });
    expect(r.criado).toBe(true);
    expect(k.tabela('deliveryAtendimentos')[0].status).toBe('AGENDADA');
  });

  it('chegada não reaproveita atendimento de outra unidade nem um já autorizado', async () => {
    const { svc, tabela } = montar({
      atendimentos: [atendimentoAuto({ id: 1, id_apartamento: 102 }), atendimentoAuto({ id: 2, status: 'AUTORIZADA' })],
    });
    const r = await svc.registrarChegadaAutoatendimento({ idCondominio: 1, idApartamento: 101, nomeEntregador: 'Carlos', plataforma: null });
    expect(r.criado).toBe(true);
    expect(tabela('deliveryAtendimentos')).toHaveLength(3);
  });

  it('vincularPedidoPortao abre o card uma vez, para todos os vínculos quando não há dono', async () => {
    const { svc, card, tabela, notifications } = montar({ atendimentos: [atendimentoAuto({ id_pedido_portao: null })], pedidos: [pedidoPendente()] });
    await svc.vincularPedidoPortao(1, 50);
    expect(tabela('deliveryAtendimentos')[0].id_pedido_portao).toBe(50);
    expect(card.abrirDelivery).toHaveBeenCalledTimes(1);
    const [a, ids] = card.abrirDelivery.mock.calls[0];
    expect(ids.sort()).toEqual([7, 9]);
    expect(a).toMatchObject({
      status: 'AGUARDANDO_AUTORIZACAO',
      entregadorNome: 'Carlos',
      entregadorPlataforma: 'iFood',
      fotoEntregador: 'https://bucket.s3.amazonaws.com/delivery-portao/1.jpg',
      portao: true,
    });
    // Sem dono: ninguém recebe a notificação "dos outros moradores".
    expect(notifications.sendPushNotification).not.toHaveBeenCalled();
  });

  it('vincularPedidoPortao abre o card só para o dono quando há dono (os outros recebem a notificação comum)', async () => {
    const { svc, card, notifications } = montar({ atendimentos: [atendimentoAuto({ id_morador_user: 7, origem: 'portaria' })], pedidos: [pedidoPendente()] });
    await svc.vincularPedidoPortao(1, 50);
    expect(card.abrirDelivery).toHaveBeenCalledTimes(1);
    expect(card.abrirDelivery.mock.calls[0][1]).toEqual([7]);
    expect(notifications.sendPushNotification).toHaveBeenCalledWith('fcm-9', 'Delivery', expect.any(String), { id_delivery: '1', status: 'AGUARDANDO_AUTORIZACAO' });
  });

  it('morador responde RETIRADA_NA_PORTARIA com pedido pendente: aceito', async () => {
    const { svc, tabela } = montar({ atendimentos: [atendimentoAuto()], pedidos: [pedidoPendente()] });
    const r = await svc.atualizarStatus(1, { status: 'RETIRADA_NA_PORTARIA' } as any, morador7);
    expect(r.status).toBe('RETIRADA_NA_PORTARIA');
    expect(tabela('deliveryAtendimentos')[0].status).toBe('RETIRADA_NA_PORTARIA');
  });

  it('morador responde RETIRADA_NA_PORTARIA sem pedido de portão: 403, como hoje', async () => {
    const semPedido = montar({ atendimentos: [atendimentoAuto({ origem: 'portaria', id_morador_user: 7, id_pedido_portao: null })] });
    await expect(semPedido.svc.atualizarStatus(1, { status: 'RETIRADA_NA_PORTARIA' } as any, morador7)).rejects.toBeInstanceOf(ForbiddenException);

    const pedidoRespondido = montar({ atendimentos: [atendimentoAuto()], pedidos: [pedidoPendente({ status: 'expirado' })] });
    await expect(pedidoRespondido.svc.atualizarStatus(1, { status: 'RETIRADA_NA_PORTARIA' } as any, morador7)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('primeira resposta em atendimento sem dono grava o dono e encerra o card dos outros', async () => {
    const { svc, tabela, card, notifications } = montar({ atendimentos: [atendimentoAuto()], pedidos: [pedidoPendente()] });
    const r = await svc.atualizarStatus(1, { status: 'AUTORIZADA' } as any, morador9);
    expect(tabela('deliveryAtendimentos')[0].id_morador_user).toBe(9);
    expect(card.encerrarDeOutros).toHaveBeenCalledWith('delivery', 1, 9);
    // Quem respondeu virou o dono: nada de "Bruno autorizou" para ele mesmo.
    expect(notifications.sendPushNotification).not.toHaveBeenCalled();
    expect(card.atualizarDelivery).toHaveBeenCalledWith(expect.objectContaining({ status: 'AUTORIZADA' }), 9, { voceRespondeu: true });
    // Resposta ao morador sem ids.
    expect(r).not.toHaveProperty('id_morador_user');
    expect(r).not.toHaveProperty('id_pedido_portao');
  });

  it('morador sem vínculo com a unidade não responde atendimento sem dono', async () => {
    const { svc } = montar({ atendimentos: [atendimentoAuto()], pedidos: [pedidoPendente()], vinculos: [{ id: 1, id_apto: 101, id_user: 7 }] });
    await expect(svc.atualizarStatus(1, { status: 'AUTORIZADA' } as any, morador9)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('morador não cancela atendimento sem dono', async () => {
    const { svc } = montar({ atendimentos: [atendimentoAuto({ status: 'AGENDADA' })] });
    await expect(svc.atualizarStatus(1, { status: 'CANCELADA', motivo: 'x' } as any, morador7)).rejects.toThrow(
      'Somente o morador solicitante pode cancelar este aviso.',
    );
  });

  it('portaria autoriza atendimento de autoatendimento sem entregador cadastrado', async () => {
    const { svc, tabela, card } = montar({ atendimentos: [atendimentoAuto()], pedidos: [pedidoPendente()] });
    const r = await svc.atualizarStatus(1, { status: 'AUTORIZADA' } as any, porteiro);
    expect(r.status).toBe('AUTORIZADA');
    expect(tabela('deliveryAtendimentos')[0].id_morador_user).toBeNull();
    // Sem dono: o card acompanha em todos os vínculos.
    expect(card.atualizarDelivery.mock.calls[0][1].sort()).toEqual([7, 9]);
  });

  it('portaria continua exigindo entregador em atendimento de origem portaria', async () => {
    const { svc } = montar({ atendimentos: [atendimentoAuto({ origem: 'portaria', id_morador_user: 7, id_pedido_portao: null })] });
    await expect(svc.atualizarStatus(1, { status: 'AUTORIZADA' } as any, porteiro)).rejects.toThrow(
      new BadRequestException('Identifique o entregador antes de autorizar o atendimento.'),
    );
  });

  it('sistema cancela AGUARDANDO_AUTORIZACAO com motivo e autor "Sistema"; usuário comum não consegue', async () => {
    const usuario = montar({ atendimentos: [atendimentoAuto({ status: 'CHEGOU' })] });
    await expect(usuario.svc.atualizarStatus(1, { status: 'CANCELADA', motivo: 'x' } as any, porteiro)).rejects.toBeInstanceOf(ConflictException);

    const { svc, tabela, card, notifications } = montar({ atendimentos: [atendimentoAuto()], pedidos: [pedidoPendente()] });
    expect(await svc.transicionarPeloSistema(1, 'CANCELADA', 'Sem resposta do morador')).toBe(true);
    const [a] = tabela('deliveryAtendimentos');
    expect(a).toMatchObject({ status: 'CANCELADA', motivo: 'Sem resposta do morador' });
    expect(a.cancelado_em).toEqual(expect.any(Date));
    expect(tabela('deliveryEventos').at(-1)).toMatchObject({
      status_anterior: 'AGUARDANDO_AUTORIZACAO',
      status_novo: 'CANCELADA',
      id_usuario_autor: null,
      autor_nome: 'Sistema',
      mensagem: 'Sem resposta do morador',
    });
    // O card acompanha (some); ninguém recebe "cancelado pela portaria".
    expect(card.atualizarDelivery).toHaveBeenCalledWith(expect.objectContaining({ status: 'CANCELADA' }), [7, 9], { voceRespondeu: false });
    expect(notifications.sendPushNotification).not.toHaveBeenCalled();
  });

  it('transicionarPeloSistema conclui AUTORIZADA e devolve false quando o status já mudou ou a transição não existe', async () => {
    const { svc, tabela } = montar({ atendimentos: [atendimentoAuto({ status: 'AUTORIZADA', id_morador_user: 7 })] });
    expect(await svc.transicionarPeloSistema(1, 'CONCLUIDA', 'Concluído na saída do entregador')).toBe(true);
    expect(tabela('deliveryAtendimentos')[0]).toMatchObject({ status: 'CONCLUIDA', concluido_em: expect.any(Date) });
    expect(await svc.transicionarPeloSistema(1, 'CONCLUIDA', 'de novo')).toBe(false);
    expect(await svc.transicionarPeloSistema(1, 'CANCELADA', 'x')).toBe(false);
    expect(await svc.transicionarPeloSistema(999, 'CANCELADA', 'x')).toBe(false);

    // Alguém mudou entre a leitura e a gravação.
    const corrida = montar({ atendimentos: [atendimentoAuto()] });
    corrida.banco.prisma.deliveryAtendimentos.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await corrida.svc.transicionarPeloSistema(1, 'CANCELADA', 'Sem resposta do morador')).toBe(false);
    expect(corrida.tabela('deliveryEventos')).toHaveLength(0);
  });

  it('gancho recebe (atendimento, statusNovo, quem) depois de cada mudança; erro do gancho não derruba a resposta', async () => {
    const { svc } = montar({ atendimentos: [atendimentoAuto()], pedidos: [pedidoPendente()] });
    const gancho: GanchoPortao = { aoMudarStatus: jest.fn(async () => { throw new Error('quebrou'); }) };
    svc.registrarGanchoPortao(gancho);
    const r = await svc.atualizarStatus(1, { status: 'AUTORIZADA' } as any, morador7);
    expect(r.status).toBe('AUTORIZADA');
    expect(gancho.aoMudarStatus).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, origem: 'autoatendimento', id_pedido_portao: 50 }),
      'AUTORIZADA',
      { idUser: 7, operador: false, sistema: false },
    );
    await svc.transicionarPeloSistema(1, 'CONCLUIDA', 'fim');
    expect(gancho.aoMudarStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 1 }),
      'CONCLUIDA',
      { idUser: null, operador: false, sistema: true },
    );

    const outro = montar({ atendimentos: [atendimentoAuto()], pedidos: [pedidoPendente()] });
    const g2: GanchoPortao = { aoMudarStatus: jest.fn(async () => undefined) };
    outro.svc.registrarGanchoPortao(g2);
    await outro.svc.atualizarStatus(1, { status: 'RECUSADA', motivo: 'Não pedi nada' } as any, porteiro);
    expect(g2.aoMudarStatus).toHaveBeenCalledWith(expect.anything(), 'RECUSADA', { idUser: null, operador: true, sistema: false });
  });

  it('lista do operador traz pedido_portao com foto e nome do portão; a do morador não traz ids', async () => {
    const pedidos = [
      pedidoPendente({ id: 49, status: 'expirado', nome: 'Antigo', criado_em: new Date(AGORA.getTime() - 600_000) }),
      pedidoPendente(),
    ];
    const { svc } = montar({ atendimentos: [atendimentoAuto()], pedidos });
    const [op] = await svc.listarAtendimentos(1, undefined, porteiro, { escopo: 'ativos' });
    expect(op.origem).toBe('autoatendimento');
    expect(op.pedido_portao).toEqual({
      nome: 'Carlos',
      plataforma: 'iFood',
      foto: 'https://bucket.s3.amazonaws.com/delivery-portao/1.jpg',
      status: 'pendente',
      portao: 'Portão social',
      aberto_em: null,
      saida_aberta_em: null,
    });
    expect(op).not.toHaveProperty('pedidosPortao');

    const [mor] = await svc.listarAtendimentos(1, undefined, morador7);
    expect(mor.origem).toBe('autoatendimento');
    expect(mor.proprio).toBe(false);
    expect(mor.pedido_portao).toMatchObject({ nome: 'Carlos', portao: 'Portão social', status: 'pendente' });
    const chaves = JSON.stringify(mor);
    expect(chaves).not.toMatch(/"id_(morador_user|pedido_portao|device|atendimento|condominio|apartamento)"/);
    expect(mor.pedido_portao).not.toHaveProperty('id');
  });

  it('atendimento sem pedido de portão sai com pedido_portao null nas duas listas', async () => {
    const { svc } = montar({ atendimentos: [atendimentoAuto({ origem: 'portaria', id_morador_user: 7, id_pedido_portao: null, status: 'CHEGOU' })] });
    const [op] = await svc.listarAtendimentos(1, undefined, porteiro, { escopo: 'ativos' });
    expect(op.pedido_portao).toBeNull();
    const [mor] = await svc.listarAtendimentos(1, undefined, morador7);
    expect(mor.pedido_portao).toBeNull();
    expect(mor.proprio).toBe(true);
  });
});
