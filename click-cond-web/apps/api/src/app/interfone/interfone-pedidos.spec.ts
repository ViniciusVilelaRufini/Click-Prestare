import { InterfoneService } from './interfone.service';
import { InterfoneAcoesService } from './interfone-acoes.service';
import { InterfonePedidosService, MENSAGENS_RAPIDAS } from './interfone-pedidos.service';
import { criarBancoFalso } from './banco-falso.spec';

/**
 * Pedido do portão (portaria autônoma): a central (ou a IA) pede, o morador da unidade autoriza ou
 * nega pelo app. Autorizar abre o portão do facial da chamada UMA vez, só dentro da janela (chamada
 * ativa ou encerrada há até 5 min), só para morador da unidade. Não cria visitante nem libera PIN.
 */

// 2026-11-27 14:05 em Brasília.
const AGORA = Date.UTC(2026, 10, 27, 17, 5, 0);
const MIN = 60_000;

function montar(opts: { dtmf?: string | null; central?: number } = {}) {
  const banco = criarBancoFalso({
    condominios: [
      {
        id: 1,
        nome: 'Residencial Teste',
        ativo: 1,
        interfone_contratado: 1,
        interfone_ativo: 1,
        central_contratada: opts.central ?? 1,
        interfone_toque_apto_s: 30,
        interfone_transferir: 1,
        interfone_toque_portaria_s: 45,
      },
      { id: 2, nome: 'Outro', ativo: 1, interfone_contratado: 1, interfone_ativo: 1, central_contratada: 1 },
    ],
    apartamentos: [
      { id: 100, id_condominio: 1, apto: '106', bloco: 'A', interfone_ramal: '106' },
      { id: 200, id_condominio: 1, apto: '201', bloco: 'A', interfone_ramal: '201' },
      { id: 900, id_condominio: 2, apto: '1', bloco: null, interfone_ramal: '1' },
    ],
    users: [
      { id: 7, name: 'Ana Morador', fcm_token: 'f7', interfone_receber: 1 },
      { id: 8, name: 'Bruno Morador', fcm_token: 'f8', interfone_receber: 1 },
      { id: 9, name: 'Carla Vizinha', fcm_token: 'f9', interfone_receber: 1 },
    ],
    apartamentos_Users: [
      { id: 1, id_apto: 100, id_user: 7, vencimento: null },
      { id: 2, id_apto: 100, id_user: 8, vencimento: null },
      { id: 3, id_apto: 200, id_user: 9, vencimento: null },
    ],
    facial_Devices: [
      {
        id: 12,
        id_condominio: 1,
        nome: 'Portão social',
        ativo: 1,
        fabricante: 'intelbras',
        interfone_habilitado: 1,
        interfone_dtmf: opts.dtmf ?? null,
      },
    ],
    central_Operadores: [{ id: 5, nome: 'Olga Operadora', email: 'olga@central.example', ativo: 1 }],
  });
  const push = {
    tocar: jest.fn(async () => ({ tocou: 2, semApp: 0, ids: [7, 8] })),
    fim: jest.fn(async () => undefined),
    perdida: jest.fn(async () => undefined),
    podemTocar: jest.fn(async (ids: number[]) => ids),
    pedido: jest.fn(async (_id: number, ids: number[]) => ({ ids, alcance: { apps: 2, antigos: 1 } })),
    pedidoFim: jest.fn(async () => undefined),
  };
  const voz = { portaria: jest.fn(async () => true), dtmf: jest.fn(async () => true), encerrar: jest.fn(async () => true) };
  const realtime = {
    porteirosOnline: jest.fn(async () => false),
    centralOnline: jest.fn(async () => true),
    emitirPortaria: jest.fn(),
    emitirCentral: jest.fn(),
  };
  const facial = {
    abrirDispositivoInterno: jest.fn(async () => ({ ok: true })),
    registrarAberturaExterna: jest.fn(async () => undefined),
  };
  const storage = { assinarUrl: jest.fn(async (u: string) => `${u}?assinada=1`) };
  const auditoria = { registrar: jest.fn(async () => undefined) };
  const relogio = { t: AGORA };
  const nucleo = new InterfoneService(banco.prisma, push as any, voz as any, realtime as any);
  nucleo.agora = () => relogio.t;
  nucleo.dormir = async () => undefined;
  const acoes = new InterfoneAcoesService(banco.prisma, nucleo, push as any, voz as any, facial as any, auditoria as any, storage as any);
  acoes.agora = () => relogio.t;
  const pedidos = new InterfonePedidosService(banco.prisma, nucleo, acoes, push as any, realtime as any, storage as any);
  pedidos.agora = () => relogio.t;
  const esperar = () => nucleo.ociosos();
  comoDateTime0(banco.prisma);
  return { ...banco, push, voz, realtime, facial, storage, auditoria, nucleo, acoes, pedidos, relogio, esperar };
}

/**
 * Como o MySQL com DATETIME(0): a data gravada perde os milissegundos (arredonda para o segundo).
 * Sem isto o banco falso guarda o milissegundo e esconde comparação por igualdade que no banco
 * real nunca casa.
 */
function comoDateTime0(prisma: any) {
  const arred = (v: unknown) => (v instanceof Date ? new Date(Math.round(v.getTime() / 1000) * 1000) : v);
  for (const modelo of ['interfone_Chamadas', 'interfone_Pedidos']) {
    for (const op of ['create', 'update', 'updateMany']) {
      const original = prisma[modelo][op].getMockImplementation();
      prisma[modelo][op].mockImplementation(async (a: any) =>
        original({ ...a, data: Object.fromEntries(Object.entries(a?.data ?? {}).map(([k, v]) => [k, arred(v)])) }),
      );
    }
  }
}

type M = ReturnType<typeof montar>;

/** Chamada atendida pela central (operadora 5), com foto do visitante. */
async function chamada(
  m: M,
  o: {
    tipo?: string;
    estado?: string;
    apto?: number | null;
    facial?: number | null;
    encerrada_em?: Date | null;
    foto?: string | null;
    created_at?: Date;
  } = {},
): Promise<number> {
  const c = await m.prisma.interfone_Chamadas.create({
    data: {
      id_condominio: 1,
      tipo: o.tipo ?? 'facial_unidade',
      estado: o.estado ?? 'atendida',
      id_apartamento: o.apto === undefined ? 100 : o.apto,
      id_facial: o.facial === undefined ? 12 : o.facial,
      atendida_em: new Date(AGORA - 20_000),
      atendida_por_tipo: 'central',
      atendida_por_id: 5,
      id_operador_central: 5,
      destino: 'central',
      foto: o.foto === undefined ? 'interfone/fotos/1.jpg' : o.foto,
      encerrada_em: o.encerrada_em ?? null,
      created_at: o.created_at ?? new Date(AGORA - MIN),
    },
  });
  return c.id;
}

function entrada(idChamada: number, o: Record<string, any> = {}) {
  return { idChamada, idApartamento: 100, nome: 'Rodrigo', motivo: 'Entrega de móveis', tipo: 'entrega' as const, origem: 'central' as const, ...o };
}

const pedidoRow = (m: M, id: number) => m.tabelas['interfone_Pedidos'].find((p: any) => p.id === id);
const chamadaRow = (m: M, id: number) => m.tabelas['interfone_Chamadas'].find((c: any) => c.id === id);

/** Encerra a chamada agora (relógio do teste). */
function encerrar(m: M, id: number) {
  Object.assign(chamadaRow(m, id), { estado: 'encerrada', resultado: 'atendida_central', encerrada_em: new Date(m.relogio.t) });
}

describe('pedido do portão — criar', () => {
  it('criar manda push aos moradores da unidade e emite interfone:pedido', async () => {
    const m = montar();
    const idChamada = await chamada(m);
    const r = await m.pedidos.criar(entrada(idChamada));
    await m.esperar();

    expect(r).toEqual({
      id: expect.any(Number),
      estado: 'pendente',
      nome_falado: 'Rodrigo',
      motivo: 'Entrega de móveis',
      tipo: 'entrega',
      mensagem: null,
      respondido_por_nome: null,
      respondido_em: null,
      portao_aberto: false,
      alcance: null,
    });
    // Copia a foto da chamada.
    expect(pedidoRow(m, r.id)).toMatchObject({
      id_chamada: idChamada,
      id_condominio: 1,
      id_apartamento: 100,
      origem: 'central',
      estado: 'pendente',
      foto: 'interfone/fotos/1.jpg',
    });
    expect(m.push.pedido).toHaveBeenCalledTimes(1);
    expect(m.push.pedido).toHaveBeenCalledWith(r.id, [7, 8], {
      id_chamada: idChamada,
      unidade: 'Bloco A · Apto 106',
      condominio: 'Residencial Teste',
      portao: 'Portão social',
      nome: 'Rodrigo',
      motivo: 'Entrega de móveis',
      tipo: 'entrega',
      foto_url: 'interfone/fotos/1.jpg?assinada=1',
    });
    const evento = { ...r, id_chamada: idChamada, id_condominio: 1 };
    expect(m.realtime.emitirPortaria).toHaveBeenCalledWith(1, 'interfone:pedido', evento);
    expect(m.realtime.emitirCentral).toHaveBeenCalledWith('interfone:pedido', evento);
    // Depois do push: alcance gravado no pedido e repetido no evento (apps novos e antigos).
    expect(pedidoRow(m, r.id)).toMatchObject({ alcance_apps: 2, alcance_antigos: 1 });
    const comAlcance = { ...evento, alcance: { apps: 2, antigos: 1 } };
    expect(m.realtime.emitirPortaria).toHaveBeenLastCalledWith(1, 'interfone:pedido', comAlcance);
    expect(m.realtime.emitirCentral).toHaveBeenLastCalledWith('interfone:pedido', comAlcance);
    await expect(m.pedidos.ultimoDaChamada(idChamada)).resolves.toMatchObject({ alcance: { apps: 2, antigos: 1 } });
  });

  it('condomínio sem central contratada: o evento vai só para a portaria do prédio', async () => {
    const m = montar({ central: 0 });
    const idChamada = await chamada(m);
    await m.pedidos.criar(entrada(idChamada));
    expect(m.realtime.emitirPortaria).toHaveBeenCalledWith(1, 'interfone:pedido', expect.anything());
    expect(m.realtime.emitirCentral).not.toHaveBeenCalled();
  });

  it('entrada inválida → 400 sem gravar nada (nome vazio, tipo desconhecido, origem desconhecida)', async () => {
    const m = montar();
    const idChamada = await chamada(m);
    await expect(m.pedidos.criar(entrada(idChamada, { nome: '   ' }))).rejects.toMatchObject({ status: 400 });
    await expect(m.pedidos.criar(entrada(idChamada, { tipo: 'mudanca' }))).rejects.toMatchObject({ status: 400 });
    await expect(m.pedidos.criar(entrada(idChamada, { origem: 'morador' }))).rejects.toMatchObject({ status: 400 });
    expect(m.tabelas['interfone_Pedidos']).toHaveLength(0);
    expect(m.push.pedido).not.toHaveBeenCalled();
  });

  it('nome e motivo longos são cortados nos tamanhos das colunas', async () => {
    const m = montar();
    const idChamada = await chamada(m);
    const r = await m.pedidos.criar(entrada(idChamada, { nome: 'N'.repeat(300), motivo: 'M'.repeat(400) }));
    expect(r.nome_falado).toHaveLength(120);
    expect(r.motivo).toHaveLength(255);
  });

  it('chamada encerrada → 409; inexistente → 404; já há pedido pendente na chamada → 409 pedido_pendente', async () => {
    const m = montar();
    const fim = await chamada(m, { estado: 'encerrada', encerrada_em: new Date(AGORA - 10_000) });
    await expect(m.pedidos.criar(entrada(fim))).rejects.toMatchObject({ status: 409 });
    await expect(m.pedidos.criar(entrada(999))).rejects.toMatchObject({ status: 404 });
    const ativa = await chamada(m);
    await m.pedidos.criar(entrada(ativa));
    await expect(m.pedidos.criar(entrada(ativa, { nome: 'Outro' }))).rejects.toMatchObject({
      status: 409,
      response: { motivo: 'pedido_pendente' },
    });
    expect(m.tabelas['interfone_Pedidos']).toHaveLength(1);
  });

  it('chamada com unidade: o pedido não vai para outra unidade (400); facial_portaria aceita unidade do condomínio e recusa a de outro (403)', async () => {
    const m = montar();
    const comUnidade = await chamada(m);
    await expect(m.pedidos.criar(entrada(comUnidade, { idApartamento: 200 }))).rejects.toMatchObject({ status: 400 });
    const portaria = await chamada(m, { tipo: 'facial_portaria', apto: null });
    await expect(m.pedidos.criar(entrada(portaria, { idApartamento: 900 }))).rejects.toMatchObject({ status: 403 });
    await expect(m.pedidos.criar(entrada(portaria, { idApartamento: 12345 }))).rejects.toMatchObject({ status: 404 });
    const r = await m.pedidos.criar(entrada(portaria, { idApartamento: 200 }));
    await m.esperar();
    expect(pedidoRow(m, r.id).id_apartamento).toBe(200);
    expect(m.push.pedido).toHaveBeenCalledWith(r.id, [9], expect.objectContaining({ unidade: 'Bloco A · Apto 201', portao: 'Portão social' }));
  });
});

describe('pedido do portão — responder', () => {
  it('autorizar abre o portão uma vez e marca autorizado', async () => {
    const m = montar();
    const idChamada = await chamada(m);
    const p = await m.pedidos.criar(entrada(idChamada));
    m.relogio.t = AGORA + 30_000;
    const r = await m.pedidos.responder(p.id, 7, 'autorizar');

    expect(r).toMatchObject({ id: p.id, estado: 'autorizado', respondido_por_nome: 'Ana Morador', portao_aberto: true });
    expect(r.respondido_em).toBe(new Date(AGORA + 30_000).toISOString());
    expect(m.facial.abrirDispositivoInterno).toHaveBeenCalledTimes(1);
    expect(m.facial.abrirDispositivoInterno).toHaveBeenCalledWith(12, expect.objectContaining({ origem: 'interfone' }));
    expect(pedidoRow(m, p.id)).toMatchObject({ estado: 'autorizado', respondido_por_id: 7, respondido_por_nome: 'Ana Morador' });
    expect(chamadaRow(m, idChamada)).toMatchObject({
      porta_aberta_em: new Date(AGORA + 30_000),
      porta_aberta_por_nome: 'Ana Morador',
      porta_aberta_como: 'agente',
    });
    expect(m.auditoria.registrar).toHaveBeenCalledTimes(1);
    expect(m.auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        acao: 'INTERFONE_ABRIR',
        modulo: 'interfone',
        id_condominio: 1,
        entidade_id: idChamada,
        autor_id: 7,
        autor_tipo: 'user',
        descricao: expect.stringContaining('aberto por autorização do morador Ana Morador (pedido do interfone)'),
      }),
    );
  });

  it('autorizar não exige que o morador tenha atendido a chamada (a central atendeu)', async () => {
    const m = montar();
    const idChamada = await chamada(m);
    const p = await m.pedidos.criar(entrada(idChamada));
    await expect(m.pedidos.responder(p.id, 8, 'autorizar')).resolves.toMatchObject({ estado: 'autorizado', portao_aberto: true });
    expect(chamadaRow(m, idChamada).atendida_por_tipo).toBe('central');
  });

  it('Review Focus 4: autorizar de novo → 409 pedido_respondido sem abrir', async () => {
    const m = montar();
    const p = await m.pedidos.criar(entrada(await chamada(m)));
    await m.pedidos.responder(p.id, 7, 'autorizar');
    await expect(m.pedidos.responder(p.id, 7, 'autorizar')).rejects.toMatchObject({ status: 409, response: { motivo: 'pedido_respondido' } });
    await expect(m.pedidos.responder(p.id, 8, 'autorizar')).rejects.toMatchObject({ status: 409, response: { motivo: 'pedido_respondido' } });
    await expect(m.pedidos.responder(p.id, 8, 'negar')).rejects.toMatchObject({ status: 409, response: { motivo: 'pedido_respondido' } });
    expect(m.facial.abrirDispositivoInterno).toHaveBeenCalledTimes(1);
    expect(pedidoRow(m, p.id)).toMatchObject({ estado: 'autorizado', respondido_por_id: 7 });
  });

  it('negado não autoriza depois (409 pedido_respondido sem abrir)', async () => {
    const m = montar();
    const p = await m.pedidos.criar(entrada(await chamada(m)));
    await m.pedidos.responder(p.id, 8, 'negar');
    await expect(m.pedidos.responder(p.id, 7, 'autorizar')).rejects.toMatchObject({ status: 409, response: { motivo: 'pedido_respondido' } });
    expect(m.facial.abrirDispositivoInterno).not.toHaveBeenCalled();
  });

  it('Review Focus 4: autorizar 6 min depois do fim da chamada → 409 pedido_expirado sem abrir', async () => {
    const m = montar();
    const idChamada = await chamada(m);
    const p = await m.pedidos.criar(entrada(idChamada));
    encerrar(m, idChamada);
    m.relogio.t = AGORA + 6 * MIN;
    await expect(m.pedidos.responder(p.id, 7, 'autorizar')).rejects.toMatchObject({ status: 409, response: { motivo: 'pedido_expirado' } });
    expect(m.facial.abrirDispositivoInterno).not.toHaveBeenCalled();
    expect(m.voz.dtmf).not.toHaveBeenCalled();
    expect(pedidoRow(m, p.id).estado).toBe('expirado');
    expect(chamadaRow(m, idChamada).porta_aberta_em).toBeNull();
    // Expirado não volta: outro morador também recebe 409 pedido_expirado.
    await expect(m.pedidos.responder(p.id, 8, 'negar')).rejects.toMatchObject({ status: 409, response: { motivo: 'pedido_expirado' } });
  });

  it('a janela conta do fim da chamada: 4 min depois do fim ainda abre', async () => {
    const m = montar();
    const idChamada = await chamada(m);
    const p = await m.pedidos.criar(entrada(idChamada));
    m.relogio.t = AGORA + 2 * MIN;
    encerrar(m, idChamada);
    m.relogio.t = AGORA + 6 * MIN;
    await expect(m.pedidos.responder(p.id, 7, 'autorizar')).resolves.toMatchObject({ estado: 'autorizado', portao_aberto: true });
    expect(m.facial.abrirDispositivoInterno).toHaveBeenCalledTimes(1);
  });

  it('chamada ainda ativa: a janela é "agora" (abre mesmo com o pedido criado há mais de 5 min)', async () => {
    const m = montar();
    const idChamada = await chamada(m);
    const p = await m.pedidos.criar(entrada(idChamada));
    m.relogio.t = AGORA + 6 * MIN;
    await expect(m.pedidos.responder(p.id, 7, 'autorizar')).resolves.toMatchObject({ portao_aberto: true });
  });

  it('chamada encerrada sem horário de fim gravado: expira (falha fechado)', async () => {
    const m = montar();
    const idChamada = await chamada(m);
    const p = await m.pedidos.criar(entrada(idChamada));
    Object.assign(chamadaRow(m, idChamada), { estado: 'encerrada', encerrada_em: null });
    await expect(m.pedidos.responder(p.id, 7, 'autorizar')).rejects.toMatchObject({ status: 409, response: { motivo: 'pedido_expirado' } });
    expect(m.facial.abrirDispositivoInterno).not.toHaveBeenCalled();
  });

  it('Review Focus 4: morador de outra unidade → 403 sem abrir nem mudar o pedido', async () => {
    const m = montar();
    const p = await m.pedidos.criar(entrada(await chamada(m)));
    await expect(m.pedidos.responder(p.id, 9, 'autorizar')).rejects.toMatchObject({ status: 403 });
    await expect(m.pedidos.responder(p.id, 0, 'autorizar')).rejects.toMatchObject({ status: 403 });
    await expect(m.pedidos.responder(p.id, 9, 'negar')).rejects.toMatchObject({ status: 403 });
    expect(m.facial.abrirDispositivoInterno).not.toHaveBeenCalled();
    expect(pedidoRow(m, p.id).estado).toBe('pendente');
  });

  it('pedido inexistente → 404', async () => {
    const m = montar();
    await expect(m.pedidos.responder(999, 7, 'autorizar')).rejects.toMatchObject({ status: 404 });
  });

  it('módulo desligado no meio do pedido → 403 sem abrir', async () => {
    const m = montar();
    const p = await m.pedidos.criar(entrada(await chamada(m)));
    m.tabelas['condominios'][0].interfone_ativo = 0;
    await expect(m.pedidos.responder(p.id, 7, 'autorizar')).rejects.toMatchObject({ status: 403, response: { motivo: 'modulo_desligado' } });
    expect(m.facial.abrirDispositivoInterno).not.toHaveBeenCalled();
    expect(pedidoRow(m, p.id).estado).toBe('pendente');
  });

  it('negar com mensagem rápida grava a mensagem e não abre', async () => {
    const m = montar();
    expect(MENSAGENS_RAPIDAS).toEqual(['Já desço', 'Deixe na portaria', 'Volte mais tarde']);
    const idChamada = await chamada(m);
    const p = await m.pedidos.criar(entrada(idChamada));
    const r = await m.pedidos.responder(p.id, 8, 'negar', '  Deixe na portaria ');
    expect(r).toMatchObject({ estado: 'negado', mensagem: 'Deixe na portaria', respondido_por_nome: 'Bruno Morador', portao_aberto: false });
    expect(pedidoRow(m, p.id)).toMatchObject({ estado: 'negado', mensagem: 'Deixe na portaria', respondido_por_id: 8 });
    expect(m.facial.abrirDispositivoInterno).not.toHaveBeenCalled();
    expect(m.voz.dtmf).not.toHaveBeenCalled();
    expect(chamadaRow(m, idChamada).porta_aberta_em).toBeNull();
    expect(m.auditoria.registrar).not.toHaveBeenCalled();
  });

  it('mensagem livre até 120 caracteres; acima disso → 400; decisão desconhecida → 400 (nada muda)', async () => {
    const m = montar();
    const p = await m.pedidos.criar(entrada(await chamada(m)));
    await expect(m.pedidos.responder(p.id, 7, 'negar', 'x'.repeat(121))).rejects.toMatchObject({ status: 400 });
    await expect(m.pedidos.responder(p.id, 7, 'talvez' as any)).rejects.toMatchObject({ status: 400 });
    expect(pedidoRow(m, p.id).estado).toBe('pendente');
    await expect(m.pedidos.responder(p.id, 7, 'autorizar', 'y'.repeat(120))).resolves.toMatchObject({ mensagem: 'y'.repeat(120) });
  });

  it('dois moradores autorizam ao mesmo tempo → exatamente um abre; o outro recebe 409 pedido_respondido', async () => {
    const m = montar();
    const p = await m.pedidos.criar(entrada(await chamada(m)));
    const rs = await Promise.allSettled([m.pedidos.responder(p.id, 7, 'autorizar'), m.pedidos.responder(p.id, 8, 'autorizar')]);
    const ok = rs.filter((r) => r.status === 'fulfilled');
    const falhas = rs.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(falhas).toHaveLength(1);
    expect(falhas[0].reason).toMatchObject({ status: 409, response: { motivo: 'pedido_respondido' } });
    expect(m.facial.abrirDispositivoInterno).toHaveBeenCalledTimes(1);
    expect(m.auditoria.registrar).toHaveBeenCalledTimes(1);
  });

  it('autorizar e negar ao mesmo tempo → só uma decisão vale; abre no máximo uma vez', async () => {
    const m = montar();
    const p = await m.pedidos.criar(entrada(await chamada(m)));
    const rs = await Promise.allSettled([m.pedidos.responder(p.id, 8, 'negar'), m.pedidos.responder(p.id, 7, 'autorizar')]);
    expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const estado = pedidoRow(m, p.id).estado;
    expect(m.facial.abrirDispositivoInterno).toHaveBeenCalledTimes(estado === 'autorizado' ? 1 : 0);
  });

  it('push pedido_fim aos outros moradores depois da resposta e interfone:pedido com o estado novo', async () => {
    const m = montar();
    const idChamada = await chamada(m);
    const p = await m.pedidos.criar(entrada(idChamada));
    m.realtime.emitirPortaria.mockClear();
    m.realtime.emitirCentral.mockClear();
    await m.pedidos.responder(p.id, 7, 'negar', 'Volte mais tarde');
    await m.esperar();
    expect(m.push.pedidoFim).toHaveBeenCalledTimes(1);
    expect(m.push.pedidoFim).toHaveBeenCalledWith(p.id, [8]);
    const ev = expect.objectContaining({ id: p.id, estado: 'negado', mensagem: 'Volte mais tarde', id_chamada: idChamada, id_condominio: 1 });
    expect(m.realtime.emitirPortaria).toHaveBeenCalledWith(1, 'interfone:pedido', ev);
    expect(m.realtime.emitirCentral).toHaveBeenCalledWith('interfone:pedido', ev);
  });

  it('pedido que expira na resposta também fecha a tela nos outros celulares', async () => {
    const m = montar();
    const idChamada = await chamada(m);
    const p = await m.pedidos.criar(entrada(idChamada));
    encerrar(m, idChamada);
    m.relogio.t = AGORA + 10 * MIN;
    await expect(m.pedidos.responder(p.id, 7, 'autorizar')).rejects.toMatchObject({ status: 409 });
    await m.esperar();
    expect(m.push.pedidoFim).toHaveBeenCalledWith(p.id, [8]);
    expect(m.realtime.emitirCentral).toHaveBeenCalledWith('interfone:pedido', expect.objectContaining({ id: p.id, estado: 'expirado' }));
  });

  it('chamada sem portão do facial (portaria_unidade, unidade_portaria): pedido é criado, autorizar não abre nada', async () => {
    for (const tipo of ['portaria_unidade', 'unidade_portaria']) {
      const m = montar();
      const idChamada = await chamada(m, { tipo, facial: null });
      const p = await m.pedidos.criar(entrada(idChamada));
      expect(p.estado).toBe('pendente');
      await m.esperar();
      expect(m.push.pedido).toHaveBeenCalledWith(p.id, [7, 8], expect.objectContaining({ portao: 'Portaria' }));
      const r = await m.pedidos.responder(p.id, 7, 'autorizar');
      expect(r).toMatchObject({ estado: 'autorizado', portao_aberto: false });
      expect(m.facial.abrirDispositivoInterno).not.toHaveBeenCalled();
      expect(m.voz.dtmf).not.toHaveBeenCalled();
      expect(chamadaRow(m, idChamada).porta_aberta_em).toBeNull();
    }
  });

  it('agente falhou e sem DTMF: autorizado, mas portao_aberto false e nada gravado na chamada', async () => {
    const m = montar();
    m.facial.abrirDispositivoInterno.mockResolvedValueOnce({ ok: false, erro: 'agente offline' } as any);
    const idChamada = await chamada(m);
    const p = await m.pedidos.criar(entrada(idChamada));
    await expect(m.pedidos.responder(p.id, 7, 'autorizar')).resolves.toMatchObject({ estado: 'autorizado', portao_aberto: false });
    expect(chamadaRow(m, idChamada).porta_aberta_em).toBeNull();
    // Não tenta de novo: o pedido já foi respondido.
    await expect(m.pedidos.responder(p.id, 7, 'autorizar')).rejects.toMatchObject({ status: 409 });
    expect(m.facial.abrirDispositivoInterno).toHaveBeenCalledTimes(1);
  });

  it('agente falhou com DTMF configurado e a chamada ativa → abre pelo DTMF', async () => {
    const m = montar({ dtmf: '#1' });
    m.facial.abrirDispositivoInterno.mockResolvedValueOnce({ ok: false, erro: 'agente offline' } as any);
    const idChamada = await chamada(m);
    const p = await m.pedidos.criar(entrada(idChamada));
    await expect(m.pedidos.responder(p.id, 7, 'autorizar')).resolves.toMatchObject({ portao_aberto: true });
    expect(m.voz.dtmf).toHaveBeenCalledWith(idChamada, '#1');
    expect(chamadaRow(m, idChamada).porta_aberta_como).toBe('dtmf');
  });

  it('facial_portaria: o morador da unidade escolhida pela central autoriza e abre o portão da chamada', async () => {
    const m = montar();
    const idChamada = await chamada(m, { tipo: 'facial_portaria', apto: null });
    const p = await m.pedidos.criar(entrada(idChamada, { idApartamento: 200 }));
    await expect(m.pedidos.responder(p.id, 7, 'autorizar')).rejects.toMatchObject({ status: 403 });
    await expect(m.pedidos.responder(p.id, 9, 'autorizar')).resolves.toMatchObject({ portao_aberto: true });
    expect(m.facial.abrirDispositivoInterno).toHaveBeenCalledTimes(1);
    expect(m.facial.abrirDispositivoInterno).toHaveBeenCalledWith(12, expect.anything());
  });

  it('pedido não cria registro em Pessoas/Visitas nem libera PIN', async () => {
    const m = montar();
    const idChamada = await chamada(m);
    const a = await m.pedidos.criar(entrada(idChamada));
    await m.pedidos.responder(a.id, 7, 'autorizar');
    const idOutra = await chamada(m);
    const b = await m.pedidos.criar(entrada(idOutra));
    await m.pedidos.responder(b.id, 8, 'negar', 'Já desço');
    await m.esperar();
    for (const modelo of ['pessoas', 'visitas', 'visitantes', 'deliveryAtendimentos', 'facial_Devices', 'apartamentos_Users', 'users', 'moradores']) {
      for (const op of ['create', 'update', 'updateMany', 'delete', 'deleteMany']) {
        expect({ modelo, op, n: m.prisma[modelo][op].mock.calls.length }).toEqual({ modelo, op, n: 0 });
      }
    }
    // Só o pedido e a chamada (porta aberta) mudam.
    const escritos = Object.keys(m.tabelas).filter((t) =>
      ['create', 'update', 'updateMany', 'delete', 'deleteMany'].some((op) => m.prisma[t][op].mock.calls.length > 0),
    );
    expect(escritos.sort()).toEqual(['interfone_Chamadas', 'interfone_Pedidos']);
    expect(m.tabelas['pessoas']).toHaveLength(0);
    expect(m.tabelas['visitas']).toHaveLength(0);
  });
});

describe('pedido do portão — consultas', () => {
  it('GET do app: morador da unidade vê o resumo; outro → 403; inexistente → 404', async () => {
    const m = montar();
    const p = await m.pedidos.criar(entrada(await chamada(m)));
    const { alcance: _alcance, ...semAlcance } = p;
    await expect(m.pedidos.paraApp(p.id, 8)).resolves.toEqual(semAlcance);
    await expect(m.pedidos.paraApp(p.id, 9)).rejects.toMatchObject({ status: 403 });
    await expect(m.pedidos.paraApp(999, 7)).rejects.toMatchObject({ status: 404 });
  });

  it('GET do app: pendente com a chamada encerrada há mais de 5 min aparece expirado', async () => {
    const m = montar();
    const idChamada = await chamada(m);
    const p = await m.pedidos.criar(entrada(idChamada));
    encerrar(m, idChamada);
    m.relogio.t = AGORA + 4 * MIN;
    await expect(m.pedidos.paraApp(p.id, 7)).resolves.toMatchObject({ estado: 'pendente' });
    m.relogio.t = AGORA + 6 * MIN;
    await expect(m.pedidos.paraApp(p.id, 7)).resolves.toMatchObject({ estado: 'expirado' });
  });

  it('último pedido da chamada (para o contexto da central), com o primeiro nome de quem respondeu', async () => {
    const m = montar();
    const idChamada = await chamada(m);
    await expect(m.pedidos.ultimoDaChamada(idChamada)).resolves.toBeNull();
    const a = await m.pedidos.criar(entrada(idChamada, { nome: 'Primeiro' }));
    await m.pedidos.responder(a.id, 7, 'negar', 'Já desço');
    const b = await m.pedidos.criar(entrada(idChamada, { nome: 'Segundo' }));
    await expect(m.pedidos.ultimoDaChamada(idChamada)).resolves.toMatchObject({ id: b.id, nome_falado: 'Segundo', estado: 'pendente' });
    await m.pedidos.responder(b.id, 7, 'autorizar');
    await expect(m.pedidos.ultimoDaChamada(idChamada)).resolves.toMatchObject({
      id: b.id,
      estado: 'autorizado',
      respondido_por_nome: 'Ana',
      portao_aberto: true,
    });
  });
});

describe('pedido do portão — correções da revisão (uma abertura por chamada, limite, vencidos, teto)', () => {
  it('segundo pedido autorizado na mesma chamada não abre de novo (ja_aberto_por_pedido)', async () => {
    const m = montar();
    const idChamada = await chamada(m);
    const a = await m.pedidos.criar(entrada(idChamada));
    await expect(m.pedidos.responder(a.id, 7, 'autorizar')).resolves.toMatchObject({ portao_aberto: true });
    m.relogio.t = AGORA + 30_000;
    const b = await m.pedidos.criar(entrada(idChamada, { nome: 'Acompanhante' }));
    await expect(m.pedidos.responder(b.id, 8, 'autorizar')).resolves.toMatchObject({ estado: 'autorizado', portao_aberto: false });
    expect(m.facial.abrirDispositivoInterno).toHaveBeenCalledTimes(1);
    await expect(m.acoes.abrirPorPedido(idChamada, { uid: 7, nome: 'Ana' })).resolves.toEqual({ ok: false, motivo: 'ja_aberto_por_pedido' });
    expect(m.facial.abrirDispositivoInterno).toHaveBeenCalledTimes(1);
  });

  it('duas aberturas por pedido ao mesmo tempo na mesma chamada → só uma aciona o portão', async () => {
    const m = montar();
    const idChamada = await chamada(m);
    const rs = await Promise.all([
      m.acoes.abrirPorPedido(idChamada, { uid: 7, nome: 'Ana' }),
      m.acoes.abrirPorPedido(idChamada, { uid: 8, nome: 'Bruno' }),
    ]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(rs.filter((r) => !r.ok)).toEqual([{ ok: false, motivo: 'ja_aberto_por_pedido' }]);
    expect(m.facial.abrirDispositivoInterno).toHaveBeenCalledTimes(1);
  });

  it('pedido que não conseguiu abrir (agente fora, sem DTMF) não gasta a abertura da chamada', async () => {
    const m = montar();
    m.facial.abrirDispositivoInterno.mockResolvedValueOnce({ ok: false, erro: 'agente offline' } as any);
    const idChamada = await chamada(m);
    const a = await m.pedidos.criar(entrada(idChamada));
    await expect(m.pedidos.responder(a.id, 7, 'autorizar')).resolves.toMatchObject({ portao_aberto: false });
    const b = await m.pedidos.criar(entrada(idChamada));
    await expect(m.pedidos.responder(b.id, 7, 'autorizar')).resolves.toMatchObject({ portao_aberto: true });
    expect(m.facial.abrirDispositivoInterno).toHaveBeenCalledTimes(2);
  });

  it('a abertura do operador não conta como abertura por pedido (o pedido ainda abre uma vez)', async () => {
    const m = montar();
    const idChamada = await chamada(m);
    await m.acoes.abrir(idChamada, { papel: 'central', uid: 5, nome: 'Olga' }, { codigo: 'entrega' });
    const a = await m.pedidos.criar(entrada(idChamada));
    await expect(m.pedidos.responder(a.id, 7, 'autorizar')).resolves.toMatchObject({ portao_aberto: true });
    expect(m.facial.abrirDispositivoInterno).toHaveBeenCalledTimes(2);
  });

  it('no máximo 3 pedidos por chamada: o 4º → 409 limite_pedidos sem push', async () => {
    const m = montar();
    const idChamada = await chamada(m);
    for (let i = 0; i < 3; i++) {
      const p = await m.pedidos.criar(entrada(idChamada, { nome: `Visitante ${i}` }));
      await m.pedidos.responder(p.id, 7, 'negar');
    }
    await expect(m.pedidos.criar(entrada(idChamada, { nome: 'Quarto' }))).rejects.toMatchObject({
      status: 409,
      response: { motivo: 'limite_pedidos' },
    });
    await m.esperar();
    expect(m.tabelas['interfone_Pedidos']).toHaveLength(3);
    expect(m.push.pedido).toHaveBeenCalledTimes(3);
  });

  it('criar duas vezes ao mesmo tempo (clique duplo) → um pedido pendente e um push só', async () => {
    const m = montar();
    const idChamada = await chamada(m);
    const rs = await Promise.allSettled([m.pedidos.criar(entrada(idChamada)), m.pedidos.criar(entrada(idChamada))]);
    await m.esperar();
    expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const falha = rs.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(falha?.reason).toMatchObject({ status: 409, response: { motivo: 'pedido_pendente' } });
    expect(m.tabelas['interfone_Pedidos']).toHaveLength(1);
    expect(m.push.pedido).toHaveBeenCalledTimes(1);
  });

  it('rotina de vencidos: pendente de chamada encerrada há mais de 5 min vira expirado, fecha a tela e avisa o console', async () => {
    const m = montar();
    const idVencida = await chamada(m);
    const vencido = await m.pedidos.criar(entrada(idVencida));
    const idViva = await chamada(m);
    const vivo = await m.pedidos.criar(entrada(idViva, { nome: 'Ainda vale' }));
    encerrar(m, idVencida);
    m.realtime.emitirCentral.mockClear();
    m.relogio.t = AGORA + 5 * MIN + 1_000;
    await expect(m.pedidos.expirarVencidos()).resolves.toBe(1);
    await m.esperar();
    expect(pedidoRow(m, vencido.id).estado).toBe('expirado');
    expect(pedidoRow(m, vivo.id).estado).toBe('pendente');
    expect(m.push.pedidoFim).toHaveBeenCalledWith(vencido.id, [7, 8]);
    expect(m.realtime.emitirCentral).toHaveBeenCalledWith('interfone:pedido', expect.objectContaining({ id: vencido.id, estado: 'expirado' }));
    expect(m.realtime.emitirPortaria).toHaveBeenCalledWith(1, 'interfone:pedido', expect.objectContaining({ id: vencido.id, estado: 'expirado' }));
    // Segunda passada não repete nada.
    await expect(m.pedidos.expirarVencidos()).resolves.toBe(0);
    await m.esperar();
    expect(m.push.pedidoFim).toHaveBeenCalledTimes(1);
  });

  it('rotina de vencidos: chamada ainda "ativa" criada há mais de 15 min também expira o pedido', async () => {
    const m = montar();
    const idChamada = await chamada(m, { created_at: new Date(AGORA - 14 * MIN) });
    const p = await m.pedidos.criar(entrada(idChamada));
    m.relogio.t = AGORA + 2 * MIN;
    await expect(m.pedidos.expirarVencidos()).resolves.toBe(1);
    expect(pedidoRow(m, p.id).estado).toBe('expirado');
  });

  it('rotina de vencidos nunca lança (banco fora)', async () => {
    const m = montar();
    m.prisma.interfone_Pedidos.findMany.mockRejectedValueOnce(new Error('banco fora'));
    await expect(m.pedidos.expirarVencidos()).resolves.toBe(0);
  });

  it('teto absoluto: nunca abre depois de 15 min da criação da chamada, mesmo com ela ativa', async () => {
    const m = montar();
    const idChamada = await chamada(m, { created_at: new Date(AGORA - 10 * MIN) });
    const p = await m.pedidos.criar(entrada(idChamada));
    m.relogio.t = AGORA + 5 * MIN + 1_000;
    await expect(m.pedidos.responder(p.id, 7, 'autorizar')).rejects.toMatchObject({ status: 409, response: { motivo: 'pedido_expirado' } });
    await expect(m.acoes.abrirPorPedido(idChamada, { uid: 7, nome: 'Ana' })).resolves.toEqual({ ok: false, motivo: 'chamada_expirada' });
    expect(m.facial.abrirDispositivoInterno).not.toHaveBeenCalled();
  });

  it('teto absoluto: chamada criada há 15 min ou menos ainda abre', async () => {
    const m = montar();
    const idChamada = await chamada(m, { created_at: new Date(AGORA - 10 * MIN) });
    const p = await m.pedidos.criar(entrada(idChamada));
    m.relogio.t = AGORA + 5 * MIN;
    await expect(m.pedidos.responder(p.id, 7, 'autorizar')).resolves.toMatchObject({ portao_aberto: true });
  });
});

describe('pedido do portão — datas com milissegundo (DATETIME(0))', () => {
  it('pedido que não abriu libera a marca da chamada mesmo com o relógio fora do segundo cheio', async () => {
    const m = montar();
    m.facial.abrirDispositivoInterno.mockResolvedValueOnce({ ok: false, erro: 'agente offline' } as any);
    const idChamada = await chamada(m);
    m.relogio.t = AGORA + 30_600;
    const a = await m.pedidos.criar(entrada(idChamada));
    await expect(m.pedidos.responder(a.id, 7, 'autorizar')).resolves.toMatchObject({ portao_aberto: false });
    expect(chamadaRow(m, idChamada).pedido_aberto_em).toBeNull();
    m.relogio.t = AGORA + 41_400;
    const b = await m.pedidos.criar(entrada(idChamada));
    await expect(m.pedidos.responder(b.id, 7, 'autorizar')).resolves.toMatchObject({ portao_aberto: true });
    expect(m.facial.abrirDispositivoInterno).toHaveBeenCalledTimes(2);
  });

  it('autorizar com o relógio fora do segundo cheio: portao_aberto true e respondido_em no segundo', async () => {
    for (const ms of [100, 499, 500, 999]) {
      const m = montar();
      const idChamada = await chamada(m);
      const p = await m.pedidos.criar(entrada(idChamada));
      m.relogio.t = AGORA + 30_000 + ms;
      const r = await m.pedidos.responder(p.id, 7, 'autorizar');
      expect({ ms, aberto: r.portao_aberto }).toEqual({ ms, aberto: true });
      expect(r.respondido_em).toBe(new Date(AGORA + 30_000).toISOString());
      await expect(m.pedidos.paraApp(p.id, 7)).resolves.toMatchObject({ portao_aberto: true });
    }
  });
});
