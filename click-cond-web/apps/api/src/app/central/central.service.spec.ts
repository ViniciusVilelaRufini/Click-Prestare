import { ForbiddenException } from '@nestjs/common';
import { InterfoneService } from '../interfone/interfone.service';
import { InterfoneAcoesService, MOTIVOS_ABERTURA } from '../interfone/interfone-acoes.service';
import { InterfonePedidosService } from '../interfone/interfone-pedidos.service';
import { verificarTokenVoz } from '../interfone/token-voz';
import { criarBancoFalso } from '../interfone/banco-falso.spec';
import { CentralController } from './central.controller';
import { CentralService } from './central.service';

/**
 * API da central (portaria autônoma, Entrega 1): o operador atende vários condomínios, então cada
 * rota confere que o condomínio contratou a central e devolve só o mínimo (LGPD).
 */

// 2026-11-27 14:05 em Brasília.
const AGORA = Date.UTC(2026, 10, 27, 17, 5, 0);
const SEGREDO = 'segredo-token-voz';
const HOJE_UTC = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 27, h, m, 0));
const ONTEM_UTC = (h: number) => new Date(Date.UTC(2026, 10, 26, h, 0, 0));

const OPERADORA = { uid: 5, nome: 'Olga Operadora' };
const TOKEN_OPERADORA: any = { sub: 5, nome: 'Olga Operadora', papel: 'operador_central', cred: 'c'.repeat(32) };
const TOKEN_PORTEIRO: any = { sub: 3, nome: 'Carlos Porteiro', id_condominio: 1, tipo_sub: 'funcionario_portaria', cred: 'x' };
const PORTEIRO = { papel: 'portaria' as const, uid: 3, nome: 'Carlos Porteiro', idCondominio: 1 };

const COND_BASE = {
  ativo: 1,
  interfone_contratado: 1,
  interfone_ativo: 1,
  interfone_toque_apto_s: 30,
  interfone_transferir: 1,
  interfone_toque_portaria_s: 45,
  interfone_numero_portaria: '0',
};

function montar(opts: { porteiroOnline?: boolean } = {}) {
  const banco = criarBancoFalso({
    condominios: [
      { id: 1, nome: 'Residencial Central', central_contratada: 1, instrucao_entregas: 'Deixe no armário 3.', ...COND_BASE },
      { id: 2, nome: 'Prédio Sem Central', central_contratada: 0, instrucao_entregas: null, ...COND_BASE },
      { id: 3, nome: 'Central Desativado', central_contratada: 1, instrucao_entregas: null, ...COND_BASE, ativo: 0 },
      { id: 4, nome: 'Torre Central Dois', central_contratada: 1, instrucao_entregas: null, ...COND_BASE },
    ],
    apartamentos: [
      { id: 100, id_condominio: 1, apto: '106', bloco: 'A', interfone_ramal: '106' },
      { id: 200, id_condominio: 1, apto: '201', bloco: 'A', interfone_ramal: '201' },
      { id: 900, id_condominio: 2, apto: '1', bloco: null, interfone_ramal: '1' },
    ],
    users: [
      { id: 7, name: 'Ana Maria Souza', email: 'ana@exemplo.com', telefone: '17999991111', cpf: '11122233344', fcm_token: 'f7', interfone_receber: 1 },
      { id: 8, name: '  Bruno Lima ', email: 'bruno@exemplo.com', telefone: '17999992222', fcm_token: 'f8', interfone_receber: 1 },
      { id: 9, name: 'Carla Vizinha', email: 'carla@exemplo.com', fcm_token: 'f9', interfone_receber: 1 },
    ],
    apartamentos_Users: [
      { id: 1, id_apto: 100, id_user: 7, vencimento: null },
      { id: 2, id_apto: 100, id_user: 8, vencimento: null },
      { id: 3, id_apto: 200, id_user: 9, vencimento: null },
    ],
    facial_Devices: [
      { id: 12, id_condominio: 1, nome: 'Portão social', ativo: 1, fabricante: 'intelbras', interfone_habilitado: 1, interfone_dtmf: null },
      { id: 22, id_condominio: 2, nome: 'Portão B', ativo: 1, fabricante: 'intelbras', interfone_habilitado: 1, interfone_dtmf: null },
    ],
    funcionarios_Portaria: [{ id: 3, nome: 'Carlos Porteiro', id_condominio: 1 }],
    central_Operadores: [{ id: 5, nome: 'Olga Operadora', email: 'olga@central.example', ativo: 1 }],
    pessoas: [
      { id: 1, id_condominio: 1, nome: 'Rodrigo Visitante', doc_identificacao: '12345678900', telefone: '17988880000' },
      { id: 2, id_condominio: 1, nome: 'Ontem Visitante', doc_identificacao: '1', telefone: '1' },
      { id: 3, id_condominio: 1, nome: 'Vizinho Visitante', doc_identificacao: '2', telefone: '2' },
      { id: 4, id_condominio: 1, nome: 'Pendente Visitante', doc_identificacao: '3', telefone: '3' },
      { id: 5, id_condominio: 1, nome: 'Diarista Sexta', doc_identificacao: '4', telefone: '4' },
      { id: 6, id_condominio: 1, nome: 'Jardineiro Segunda', doc_identificacao: '5', telefone: '5' },
    ],
    visitas: [
      // Hoje às 15:30 (Brasília), para a unidade 100: aparece.
      { id: 1, id_pessoa: 1, id_condominio: 1, id_apartamento: 100, bloqueado: 0, liberado: 1, data_saida: null, data_hora_inicio: HOJE_UTC(18, 30), data_hora_termino: HOJE_UTC(22) },
      // Ontem: não aparece.
      { id: 2, id_pessoa: 2, id_condominio: 1, id_apartamento: 100, bloqueado: 0, liberado: 1, data_saida: null, data_hora_inicio: ONTEM_UTC(18), data_hora_termino: ONTEM_UTC(20) },
      // Outra unidade: não aparece.
      { id: 3, id_pessoa: 3, id_condominio: 1, id_apartamento: 200, bloqueado: 0, liberado: 1, data_saida: null, data_hora_inicio: HOJE_UTC(18), data_hora_termino: HOJE_UTC(20) },
      // Não liberada (pedido pendente, negado ou revogado): não aparece.
      { id: 4, id_pessoa: 4, id_condominio: 1, id_apartamento: 100, bloqueado: 0, liberado: 0, data_saida: null, data_hora_inicio: HOJE_UTC(19), data_hora_termino: HOJE_UTC(21) },
      // Recorrente de vários dias, às sextas (27/11/2026 é sexta): aparece, sem hora no dia.
      { id: 5, id_pessoa: 5, id_condominio: 1, id_apartamento: 100, bloqueado: 0, liberado: 1, data_saida: null, dias_semana: 'seg,sex', data_hora_inicio: new Date(Date.UTC(2026, 10, 1, 11)), data_hora_termino: new Date(Date.UTC(2026, 11, 31, 20)) },
      // Recorrente só às segundas: hoje (sexta) não aparece.
      { id: 6, id_pessoa: 6, id_condominio: 1, id_apartamento: 100, bloqueado: 0, liberado: 1, data_saida: null, dias_semana: 'seg', data_hora_inicio: new Date(Date.UTC(2026, 10, 1, 11)), data_hora_termino: new Date(Date.UTC(2026, 11, 31, 20)) },
    ],
    visitantes: [
      // Cadastro antigo (Visitantes), hoje às 10:00 (Brasília).
      { id: 1, nome: 'Paula Legado', doc_identificacao: '99988877766', id_apartamento: 100, id_condominio: 1, bloqueado: 0, liberado: 1, data_saida: null, data_hora_inicio: HOJE_UTC(13), data_hora_termino: HOJE_UTC(23) },
      // Cadastro antigo não liberado e recorrente fora do dia: não aparecem.
      { id: 2, nome: 'Negado Legado', id_apartamento: 100, id_condominio: 1, bloqueado: 0, liberado: 0, data_saida: null, data_hora_inicio: HOJE_UTC(14), data_hora_termino: HOJE_UTC(23) },
      { id: 3, nome: 'Quarta Legado', id_apartamento: 100, id_condominio: 1, bloqueado: 0, liberado: 1, data_saida: null, dias_semana: 'qua', data_hora_inicio: HOJE_UTC(14), data_hora_termino: HOJE_UTC(23) },
    ],
    deliveryAtendimentos: [
      { id: 1, id_condominio: 1, id_apartamento: 100, estabelecimento: 'iFood', nome_entregador: 'Zé Entregador', telefone_entregador: '17977776666', status: 'AGENDADA', previsao_em: HOJE_UTC(17, 30), created_at: HOJE_UTC(16) },
      { id: 2, id_condominio: 1, id_apartamento: 100, estabelecimento: 'Mercado', status: 'CONCLUIDA', previsao_em: HOJE_UTC(15), created_at: HOJE_UTC(14) },
    ],
    guarita_Alertas: [
      { id: 1, id_condominio: 1, id_device: 50, tipo: 'panico', descricao: 'Pânico acionado no Guarita', dados: '{"serial":"1A2B3C4"}', created_at: HOJE_UTC(16) },
      { id: 2, id_condominio: 1, id_device: 50, tipo: 'porta_aberta', descricao: 'Porta aberta', created_at: HOJE_UTC(15), visto_em: HOJE_UTC(15, 30), visto_por: 'Carlos Porteiro' },
      { id: 3, id_condominio: 2, id_device: 60, tipo: 'panico', descricao: 'Pânico de outro prédio', created_at: HOJE_UTC(16) },
    ],
  });
  const push = {
    tocar: jest.fn(async () => ({ tocou: 2, semApp: 0, ids: [7, 8] })),
    fim: jest.fn(async () => undefined),
    perdida: jest.fn(async () => undefined),
    podemTocar: jest.fn(async (ids: number[]) => ids.filter((i) => i === 7 || i === 8)),
    pedido: jest.fn(async (_id: number, ids: number[]) => ({ ids })),
    pedidoFim: jest.fn(async () => undefined),
  };
  const voz = { portaria: jest.fn(async () => true), dtmf: jest.fn(async () => true), encerrar: jest.fn(async () => true) };
  const realtime = {
    porteirosOnline: jest.fn(async () => opts.porteiroOnline ?? false),
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
  const nucleo = new InterfoneService(banco.prisma, push as any, voz as any, realtime as any);
  nucleo.agora = () => AGORA;
  nucleo.dormir = async () => undefined;
  const acoes = new InterfoneAcoesService(banco.prisma, nucleo, push as any, voz as any, facial as any, auditoria as any, storage as any);
  acoes.agora = () => AGORA;
  const pedidos = new InterfonePedidosService(banco.prisma, nucleo, acoes, push as any, realtime as any, storage as any);
  pedidos.agora = () => AGORA;
  const central = new CentralService(banco.prisma, nucleo, acoes, pedidos, storage as any);
  central.agora = () => AGORA;
  const ctrl = new CentralController(central);
  return { ...banco, push, voz, realtime, facial, storage, auditoria, nucleo, acoes, pedidos, central, ctrl };
}

type M = ReturnType<typeof montar>;

/** Chamada já na portaria (o toque esgotou ou o visitante discou a portaria). */
async function naPortaria(
  m: M,
  o: {
    cond?: number;
    tipo?: string;
    apto?: number | null;
    facial?: number | null;
    created_at?: Date;
    foto?: string | null;
    /** Para onde foi encaminhada (padrão 'central'). */
    destino?: string | null;
  } = {},
): Promise<number> {
  const cond = o.cond ?? 1;
  const c = await m.prisma.interfone_Chamadas.create({
    data: {
      id_condominio: cond,
      tipo: o.tipo ?? 'facial_unidade',
      estado: 'portaria',
      id_apartamento: o.apto === undefined ? (cond === 1 ? 100 : 900) : o.apto,
      id_facial: o.facial === undefined ? (cond === 1 ? 12 : 22) : o.facial,
      motivo_portaria: 'nao_atendeu',
      destino: o.destino === undefined ? 'central' : o.destino,
      foto: o.foto ?? null,
      created_at: o.created_at ?? new Date(AGORA - 30_000),
    },
  });
  return c.id;
}

const linha = (m: M, id: number) => m.tabelas['interfone_Chamadas'].find((c: any) => c.id === id);

/** Todas as chaves (inclusive aninhadas) de um objeto. */
function chaves(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => chaves(x, out));
  else if (v && typeof v === 'object' && !(v instanceof Date)) {
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      chaves(x, out);
    }
  }
  return out;
}

const antes = { t: process.env['VOZ_TOKEN_SECRET'], u: process.env['VOZ_TURN_SECRET'] };
beforeEach(() => {
  process.env['VOZ_TOKEN_SECRET'] = SEGREDO;
  process.env['VOZ_TURN_SECRET'] = 'turn';
});
afterAll(() => {
  for (const [k, v] of [['VOZ_TOKEN_SECRET', antes.t], ['VOZ_TURN_SECRET', antes.u]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('central — acesso (Review Focus 3)', () => {
  it('token de porteiro em GET central/fila → 403 sem consultar nada', async () => {
    const m = montar();
    const espiao = jest.spyOn(m.central, 'fila');
    await expect(m.ctrl.fila(TOKEN_PORTEIRO)).rejects.toBeInstanceOf(ForbiddenException);
    expect(espiao).not.toHaveBeenCalled();
  });

  it('operador com senha temporária (trocar_senha) em GET central/fila → 403 trocar_senha', async () => {
    const m = montar();
    const espiao = jest.spyOn(m.central, 'fila');
    await expect(m.ctrl.fila({ ...TOKEN_OPERADORA, trocar_senha: true })).rejects.toMatchObject({
      status: 403,
      response: { motivo: 'trocar_senha' },
    });
    expect(espiao).not.toHaveBeenCalled();
  });

  it('token de porteiro ou de morador é recusado em todas as rotas da central', async () => {
    const m = montar();
    const morador: any = { sub: 7, nome: 'Ana', typeAccess: 'Morador', user: { id: 7, typeAccess: 'Morador' } };
    for (const t of [TOKEN_PORTEIRO, morador, undefined, { ...TOKEN_OPERADORA, trocar_senha: true }]) {
      const chamadas: Array<() => unknown> = [
        () => m.ctrl.condominios(t),
        () => m.ctrl.fila(t),
        () => m.ctrl.atender(1, t),
        () => m.ctrl.abrir(1, { codigo: 'entrega' }, t),
        () => m.ctrl.encerrar(1, t),
        () => m.ctrl.contexto(1, t),
        () => m.ctrl.ligar({ id_apartamento: 100 }, t),
        () => m.ctrl.historico('2026-11-27', t),
        () => m.ctrl.alertas('1', t),
        () => m.ctrl.alertaVisto(1, t),
        () => m.ctrl.pedido(1, { nome: 'Rodrigo', tipo: 'visita' }, t),
      ];
      for (const f of chamadas) await expect((async () => f())()).rejects.toBeInstanceOf(ForbiddenException);
    }
  });
});

describe('central — condomínios e fila', () => {
  it('condominios: só os ativos com central contratada, com o destino da portaria agora', async () => {
    const m = montar();
    const r = await m.ctrl.condominios(TOKEN_OPERADORA);
    expect(r).toEqual([
      { id: 1, nome: 'Residencial Central', destino: 'central' },
      { id: 4, nome: 'Torre Central Dois', destino: 'central' },
    ]);
  });

  it('condominios: porteiro online no prédio e sem faixa da central → destino local', async () => {
    const m = montar({ porteiroOnline: true });
    const r = await m.ctrl.condominios(TOKEN_OPERADORA);
    expect(r.map((c: any) => c.destino)).toEqual(['local', 'local']);
  });

  it('fila só traz condomínios com central contratada (e só chamadas na portaria)', async () => {
    const m = montar();
    const daCentral = await naPortaria(m, { foto: 'https://bucket/interfone/f.jpg' });
    await naPortaria(m, { cond: 2 });
    await naPortaria(m, { cond: 3, apto: null, facial: null });
    const tocando = await naPortaria(m);
    linha(m, tocando).estado = 'chamando';
    const encerrada = await naPortaria(m);
    linha(m, encerrada).estado = 'encerrada';
    const portariaSemUnidade = await naPortaria(m, { tipo: 'facial_portaria', apto: null });
    await naPortaria(m, { destino: 'local' });
    await naPortaria(m, { destino: null });

    const fila = await m.ctrl.fila(TOKEN_OPERADORA);
    expect(fila.map((c: any) => c.id).sort()).toEqual([daCentral, portariaSemUnidade].sort());
    const item = fila.find((c: any) => c.id === daCentral);
    expect(item).toEqual({
      id: daCentral,
      tipo: 'facial_unidade',
      unidade: 'Bloco A · Apto 106',
      motivo: 'nao_atendeu',
      morador_nome: null,
      foto_url: 'https://bucket/interfone/f.jpg?assinada=1',
      id_condominio: 1,
      condominio: 'Residencial Central',
      portao: 'Portão social',
      criada_em: new Date(AGORA - 30_000).toISOString(),
    });
    expect(fila.find((c: any) => c.id === portariaSemUnidade)).toMatchObject({ tipo: 'facial_portaria', unidade: '' });
  });

  it('fila não traz chamada órfã (na portaria há mais de 4 min)', async () => {
    const m = montar();
    await naPortaria(m, { created_at: new Date(AGORA - 5 * 60_000) });
    await expect(m.ctrl.fila(TOKEN_OPERADORA)).resolves.toEqual([]);
  });
});

describe('central — atender', () => {
  it('operador atende chamada em estado portaria de condomínio da central', async () => {
    const m = montar();
    const id = await naPortaria(m);
    const d = await m.ctrl.atender(id, TOKEN_OPERADORA);
    expect(verificarTokenVoz(d.token, SEGREDO, AGORA / 1000)).toEqual({ cid: id, papel: 'central', uid: 5, nome: 'Olga Operadora' });
    // R2: o operador fica gravado na chamada.
    expect(linha(m, id).id_operador_central).toBe(5);
    expect(linha(m, id).estado).toBe('portaria');
  });

  it('atende facial_portaria e unidade_portaria; não atende chamada ainda tocando no apartamento', async () => {
    const m = montar();
    const portaria = await naPortaria(m, { tipo: 'facial_portaria', apto: null });
    await expect(m.ctrl.atender(portaria, TOKEN_OPERADORA)).resolves.toMatchObject({ id: portaria });
    const doApp = await naPortaria(m, { tipo: 'unidade_portaria', facial: null });
    await expect(m.ctrl.atender(doApp, TOKEN_OPERADORA)).resolves.toMatchObject({ id: doApp });
    const tocando = await naPortaria(m);
    linha(m, tocando).estado = 'chamando';
    await expect(m.ctrl.atender(tocando, TOKEN_OPERADORA)).rejects.toMatchObject({ status: 409 });
  });

  it('condomínio sem central → 403', async () => {
    const m = montar();
    const id = await naPortaria(m, { cond: 2 });
    await expect(m.ctrl.atender(id, TOKEN_OPERADORA)).rejects.toMatchObject({ status: 403 });
    expect(linha(m, id).id_operador_central).toBeNull();
  });

  it('condomínio desativado (mesmo com central) → 403', async () => {
    const m = montar();
    const id = await naPortaria(m, { cond: 3, apto: null, facial: null });
    await expect(m.ctrl.atender(id, TOKEN_OPERADORA)).rejects.toMatchObject({ status: 403 });
  });

  it('chamada inexistente → 404', async () => {
    const m = montar();
    await expect(m.ctrl.atender(999, TOKEN_OPERADORA)).rejects.toMatchObject({ status: 404 });
  });

  it('Review Focus 5: porteiro e operador atendem ao mesmo tempo: um vence, o outro recebe 409 atendida_por_outro', async () => {
    for (const ordem of ['porteiro_primeiro', 'operador_primeiro']) {
      const m = montar({ porteiroOnline: true });
      const id = await naPortaria(m);
      const porteiro = () => m.acoes.atender(id, PORTEIRO);
      const operador = () => m.ctrl.atender(id, TOKEN_OPERADORA);
      const r = await Promise.allSettled(ordem === 'porteiro_primeiro' ? [porteiro(), operador()] : [operador(), porteiro()]);
      const ok = r.filter((x) => x.status === 'fulfilled');
      const recusados = r.filter((x): x is PromiseRejectedResult => x.status === 'rejected');
      expect(ok).toHaveLength(1);
      expect(recusados).toHaveLength(1);
      expect(recusados[0].reason).toMatchObject({ status: 409, response: { motivo: 'atendida_por_outro' } });
      const vencedor = verificarTokenVoz((ok[0] as PromiseFulfilledResult<any>).value.token, SEGREDO, AGORA / 1000);
      expect(['portaria', 'central']).toContain(vencedor?.papel);
      // Só o operador que venceu fica gravado na chamada.
      expect(linha(m, id).id_operador_central).toBe(vencedor?.papel === 'central' ? 5 : null);
    }
  });

  it('Review Focus 5 (em sequência): quem chega depois recebe 409 atendida_por_outro, nos dois sentidos', async () => {
    const m = montar({ porteiroOnline: true });
    const a = await naPortaria(m);
    await m.acoes.atender(a, PORTEIRO);
    await expect(m.ctrl.atender(a, TOKEN_OPERADORA)).rejects.toMatchObject({ status: 409, response: { motivo: 'atendida_por_outro' } });
    expect(linha(m, a).id_operador_central).toBeNull();
    const b = await naPortaria(m);
    await m.ctrl.atender(b, TOKEN_OPERADORA);
    await expect(m.acoes.atender(b, PORTEIRO)).rejects.toMatchObject({ status: 409, response: { motivo: 'atendida_por_outro' } });
    // O mesmo operador pode repetir (reconexão).
    await expect(m.ctrl.atender(b, TOKEN_OPERADORA)).resolves.toMatchObject({ id: b });
  });

  it('a mídia do operador marca atendida_por central e mantém o operador; a do porteiro limpa o operador', async () => {
    const m = montar();
    const id = await naPortaria(m);
    await m.ctrl.atender(id, TOKEN_OPERADORA);
    await m.nucleo.evento(id, { evento: 'atendida', papel: 'central', uid: 5 });
    expect(linha(m, id)).toMatchObject({ estado: 'atendida', atendida_por_tipo: 'central', atendida_por_id: 5, atendida_por_nome: 'Olga Operadora', id_operador_central: 5 });

    const outra = await naPortaria(m);
    await m.ctrl.atender(outra, TOKEN_OPERADORA);
    // O operador desistiu; a reserva venceu e o porteiro entrou.
    await m.nucleo.evento(outra, { evento: 'atendida', papel: 'portaria', uid: 3 });
    expect(linha(m, outra)).toMatchObject({ atendida_por_tipo: 'portaria', id_operador_central: null });
  });

  it('o mesmo operador que já entrou repete o atender (reconexão): mesmos dados; outro operador → 409', async () => {
    const m = montar();
    const id = await naPortaria(m);
    await m.ctrl.atender(id, TOKEN_OPERADORA);
    await m.nucleo.evento(id, { evento: 'atendida', papel: 'central', uid: 5 });
    const d = await m.ctrl.atender(id, TOKEN_OPERADORA);
    expect(verificarTokenVoz(d.token, SEGREDO, AGORA / 1000)).toEqual({ cid: id, papel: 'central', uid: 5, nome: 'Olga Operadora' });
    await expect(m.ctrl.atender(id, { ...TOKEN_OPERADORA, sub: 6, nome: 'Outro Operador' })).rejects.toMatchObject({
      status: 409,
      response: { motivo: 'atendida_por_outro' },
    });
  });

  it('chamada atendida pelo porteiro → 409 atendida_por_outro para o operador', async () => {
    const m = montar();
    const id = await naPortaria(m);
    await m.nucleo.evento(id, { evento: 'atendida', papel: 'portaria', uid: 3 });
    await expect(m.ctrl.atender(id, TOKEN_OPERADORA)).rejects.toMatchObject({ status: 409, response: { motivo: 'atendida_por_outro' } });
  });
});

describe('central — abrir com motivo', () => {
  async function atendidaPelaCentral(m: M, tipo = 'facial_unidade') {
    const id = await naPortaria(m, tipo === 'facial_portaria' ? { tipo, apto: null } : { tipo });
    await m.ctrl.atender(id, TOKEN_OPERADORA);
    await m.nucleo.evento(id, { evento: 'atendida', papel: 'central', uid: 5 });
    return id;
  }

  it('MOTIVOS_ABERTURA são os seis do contrato', () => {
    expect(MOTIVOS_ABERTURA).toEqual(['visitante_identificado', 'entrega', 'prestador', 'morador_sem_acesso', 'emergencia', 'outro']);
  });

  it('abrir pela central sem motivo → 400 motivo_obrigatorio, sem acionar o portão', async () => {
    const m = montar();
    const id = await atendidaPelaCentral(m);
    await expect(m.ctrl.abrir(id, {} as any, TOKEN_OPERADORA)).rejects.toMatchObject({ status: 400, response: { motivo: 'motivo_obrigatorio' } });
    await expect(m.ctrl.abrir(id, undefined as any, TOKEN_OPERADORA)).rejects.toMatchObject({ status: 400, response: { motivo: 'motivo_obrigatorio' } });
    await expect(m.acoes.abrir(id, { papel: 'central', uid: 5, nome: 'Olga Operadora' })).rejects.toMatchObject({ status: 400 });
    expect(m.facial.abrirDispositivoInterno).not.toHaveBeenCalled();
  });

  it('motivo outro sem detalhe → 400; motivo desconhecido → 400', async () => {
    const m = montar();
    const id = await atendidaPelaCentral(m);
    await expect(m.ctrl.abrir(id, { codigo: 'outro' }, TOKEN_OPERADORA)).rejects.toMatchObject({ status: 400, response: { motivo: 'motivo_obrigatorio' } });
    await expect(m.ctrl.abrir(id, { codigo: 'outro', detalhe: '   ' }, TOKEN_OPERADORA)).rejects.toMatchObject({ status: 400 });
    await expect(m.ctrl.abrir(id, { codigo: 'amigo_do_sindico' } as any, TOKEN_OPERADORA)).rejects.toMatchObject({ status: 400, response: { motivo: 'motivo_invalido' } });
    expect(m.facial.abrirDispositivoInterno).not.toHaveBeenCalled();
  });

  it('abrir com motivo grava auditoria com operador e condomínio', async () => {
    const m = montar();
    const id = await atendidaPelaCentral(m);
    await expect(m.ctrl.abrir(id, { codigo: 'outro', detalhe: ' Técnico da operadora de internet ' }, TOKEN_OPERADORA)).resolves.toEqual({ ok: true });
    expect(m.facial.abrirDispositivoInterno).toHaveBeenCalledWith(12, expect.objectContaining({ origem: 'interfone' }));
    expect(linha(m, id)).toMatchObject({ porta_aberta_por_nome: 'Olga Operadora', porta_aberta_como: 'agente' });
    expect(m.auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        acao: 'INTERFONE_ABRIR',
        modulo: 'interfone',
        id_condominio: 1,
        entidade_id: id,
        autor_id: 5,
        autor_tipo: 'operador_central',
        usuario_nome: 'Olga Operadora',
        detalhes: expect.objectContaining({ papel: 'central', motivo: { codigo: 'outro', detalhe: 'Técnico da operadora de internet' } }),
      }),
    );
  });

  it('abrir funciona em facial_portaria (operador)', async () => {
    const m = montar();
    const id = await atendidaPelaCentral(m, 'facial_portaria');
    await expect(m.ctrl.abrir(id, { codigo: 'entrega' }, TOKEN_OPERADORA)).resolves.toEqual({ ok: true });
    expect(m.facial.abrirDispositivoInterno).toHaveBeenCalledWith(12, expect.objectContaining({ nomePessoa: 'Interfone portaria' }));
    expect(m.auditoria.registrar).toHaveBeenCalledWith(expect.objectContaining({ detalhes: expect.objectContaining({ motivo: { codigo: 'entrega' } }) }));
  });

  it('operador que não atendeu não abre (atendida_por_outro); condomínio sem central → 403', async () => {
    const m = montar();
    const id = await naPortaria(m);
    await m.nucleo.evento(id, { evento: 'atendida', papel: 'portaria', uid: 3 });
    await expect(m.ctrl.abrir(id, { codigo: 'entrega' }, TOKEN_OPERADORA)).resolves.toEqual({ ok: false, motivo: 'atendida_por_outro' });
    const fora = await naPortaria(m, { cond: 2 });
    await m.nucleo.evento(fora, { evento: 'atendida', papel: 'central', uid: 5 });
    await expect(m.ctrl.abrir(fora, { codigo: 'entrega' }, TOKEN_OPERADORA)).rejects.toMatchObject({ status: 403 });
    expect(m.facial.abrirDispositivoInterno).not.toHaveBeenCalled();
  });

  it('ligação do app (unidade_portaria) não tem portão → sem_portao', async () => {
    const m = montar();
    const id = await atendidaPelaCentral(m, 'unidade_portaria');
    await expect(m.ctrl.abrir(id, { codigo: 'entrega' }, TOKEN_OPERADORA)).resolves.toEqual({ ok: false, motivo: 'sem_portao' });
  });
});

describe('central — encerrar e ligar', () => {
  it('encerrar: chamada na portaria do condomínio da central; outro condomínio → 403', async () => {
    const m = montar();
    const id = await naPortaria(m);
    await expect(m.ctrl.encerrar(id, TOKEN_OPERADORA)).resolves.toEqual({ ok: true });
    expect(m.voz.encerrar).toHaveBeenCalledWith(id);
    const fora = await naPortaria(m, { cond: 2 });
    await expect(m.ctrl.encerrar(fora, TOKEN_OPERADORA)).rejects.toMatchObject({ status: 403 });
  });

  it('encerrar: atendida por outra pessoa → 403', async () => {
    const m = montar();
    const id = await naPortaria(m);
    await m.nucleo.evento(id, { evento: 'atendida', papel: 'portaria', uid: 3 });
    await expect(m.ctrl.encerrar(id, TOKEN_OPERADORA)).rejects.toMatchObject({ status: 403 });
    expect(m.voz.encerrar).not.toHaveBeenCalled();
  });

  it('ligar: toca a unidade de condomínio da central e grava o operador; devolve token de origem', async () => {
    const m = montar();
    const d = await m.ctrl.ligar({ id_apartamento: 100 }, TOKEN_OPERADORA);
    expect(verificarTokenVoz(d.token, SEGREDO, AGORA / 1000)).toMatchObject({ papel: 'origem', uid: 5 });
    const c = linha(m, d.id);
    expect(c).toMatchObject({ tipo: 'portaria_unidade', estado: 'chamando', id_apartamento: 100, id_operador_central: 5, id_porteiro_origem: null });
    await m.nucleo.ociosos();
    expect(m.push.tocar).toHaveBeenCalledWith(d.id, [7, 8], expect.objectContaining({ condominio: 'Residencial Central' }));
  });

  it('ligar: unidade de condomínio sem central → 403; unidade inexistente → 404; id inválido → 400', async () => {
    const m = montar();
    await expect(m.ctrl.ligar({ id_apartamento: 900 }, TOKEN_OPERADORA)).rejects.toMatchObject({ status: 403 });
    await expect(m.ctrl.ligar({ id_apartamento: 12345 }, TOKEN_OPERADORA)).rejects.toMatchObject({ status: 404 });
    await expect(m.ctrl.ligar({ id_apartamento: 'x' as any }, TOKEN_OPERADORA)).rejects.toMatchObject({ status: 400 });
    expect(m.tabelas['interfone_Chamadas']).toHaveLength(0);
  });
});

describe('central — contexto (LGPD)', () => {
  it('contexto: condomínio, portão, unidade, primeiro nome dos moradores, esperados hoje e instrução de entregas', async () => {
    const m = montar();
    const id = await naPortaria(m);
    const ctx = await m.ctrl.contexto(id, TOKEN_OPERADORA);
    expect(ctx).toEqual({
      condominio: 'Residencial Central',
      portao: 'Portão social',
      unidade: 'Bloco A · Apto 106',
      moradores: ['Ana', 'Bruno'],
      esperados_hoje: [
        { nome: 'Paula Legado', horario: '10:00', tipo: 'convite' },
        { nome: 'iFood', horario: '14:30', tipo: 'entrega' },
        { nome: 'Rodrigo Visitante', horario: '15:30', tipo: 'convite' },
        { nome: 'Diarista Sexta', horario: null, tipo: 'convite' },
      ],
      instrucao_entregas: 'Deixe no armário 3.',
      pedido: null,
    });
  });

  it('contexto não traz telefone, e-mail nem documento', async () => {
    const m = montar();
    const id = await naPortaria(m);
    const ctx = await m.ctrl.contexto(id, TOKEN_OPERADORA);
    const todas = [...chaves(ctx)];
    expect(todas.sort()).toEqual(
      ['condominio', 'portao', 'unidade', 'moradores', 'esperados_hoje', 'instrucao_entregas', 'pedido', 'nome', 'horario', 'tipo'].sort(),
    );
    for (const k of todas) expect(k).not.toMatch(/telefone|email|e-mail|documento|doc|cpf/i);
    const texto = JSON.stringify(ctx);
    for (const dado of ['17999991111', 'ana@exemplo.com', '11122233344', '12345678900', '17988880000', '99988877766', '17977776666', 'Zé Entregador', 'Souza']) {
      expect(texto).not.toContain(dado);
    }
  });

  it('contexto de facial_portaria (sem unidade): sem moradores nem esperados', async () => {
    const m = montar();
    const id = await naPortaria(m, { tipo: 'facial_portaria', apto: null });
    await expect(m.ctrl.contexto(id, TOKEN_OPERADORA)).resolves.toEqual({
      condominio: 'Residencial Central',
      portao: 'Portão social',
      unidade: '',
      moradores: [],
      esperados_hoje: [],
      instrucao_entregas: 'Deixe no armário 3.',
      pedido: null,
    });
  });

  it('contexto: condomínio sem central → 403; chamada atendida por outra pessoa ou encerrada → 403', async () => {
    const m = montar();
    const fora = await naPortaria(m, { cond: 2 });
    await expect(m.ctrl.contexto(fora, TOKEN_OPERADORA)).rejects.toMatchObject({ status: 403 });
    const doPorteiro = await naPortaria(m);
    await m.nucleo.evento(doPorteiro, { evento: 'atendida', papel: 'portaria', uid: 3 });
    await expect(m.ctrl.contexto(doPorteiro, TOKEN_OPERADORA)).rejects.toMatchObject({ status: 403 });
    const dela = await naPortaria(m);
    await m.nucleo.evento(dela, { evento: 'atendida', papel: 'central', uid: 5 });
    await expect(m.ctrl.contexto(dela, TOKEN_OPERADORA)).resolves.toMatchObject({ unidade: 'Bloco A · Apto 106' });
    linha(m, dela).estado = 'encerrada';
    await expect(m.ctrl.contexto(dela, TOKEN_OPERADORA)).rejects.toMatchObject({ status: 403 });
    await expect(m.ctrl.contexto(999, TOKEN_OPERADORA)).rejects.toMatchObject({ status: 404 });
  });
});

describe('central — histórico', () => {
  it('chamadas atendidas pela central no dia, de todos os condomínios, com o condomínio', async () => {
    const m = montar();
    const dela = await naPortaria(m, { created_at: HOJE_UTC(15) });
    await m.nucleo.evento(dela, { evento: 'atendida', papel: 'central', uid: 5 });
    const doPorteiro = await naPortaria(m, { created_at: HOJE_UTC(15, 10) });
    await m.nucleo.evento(doPorteiro, { evento: 'atendida', papel: 'portaria', uid: 3 });
    const deOntem = await naPortaria(m, { created_at: ONTEM_UTC(15) });
    await m.nucleo.evento(deOntem, { evento: 'atendida', papel: 'central', uid: 5 });
    const ligacao = await m.ctrl.ligar({ id_apartamento: 100 }, TOKEN_OPERADORA);
    linha(m, ligacao.id).created_at = HOJE_UTC(16);

    const hoje = await m.ctrl.historico('2026-11-27', TOKEN_OPERADORA);
    expect(hoje.map((c: any) => c.id)).toEqual([ligacao.id, dela]);
    expect(hoje[1]).toMatchObject({
      id: dela,
      id_condominio: 1,
      condominio: 'Residencial Central',
      unidade: 'Bloco A · Apto 106',
      portao: 'Portão social',
      atendida_por_nome: 'Olga Operadora',
      estado: 'atendida',
    });
    const ontem = await m.ctrl.historico('2026-11-26', TOKEN_OPERADORA);
    expect(ontem.map((c: any) => c.id)).toEqual([deOntem]);
  });

  it('data inválida, futura ou além de 30 dias → 400', async () => {
    const m = montar();
    for (const d of ['ontem', '2026-11-28', '2026-10-01', '2026-02-30', undefined]) {
      await expect(m.ctrl.historico(d as any, TOKEN_OPERADORA)).rejects.toMatchObject({ status: 400 });
    }
  });
});

describe('central — alertas do Guarita', () => {
  it('alertas?pendentes=1: só os não vistos dos condomínios da central, com o condomínio', async () => {
    const m = montar();
    const pend = await m.ctrl.alertas('1', TOKEN_OPERADORA);
    expect(pend).toEqual([
      {
        id: 1,
        id_condominio: 1,
        condominio: 'Residencial Central',
        tipo: 'panico',
        descricao: 'Pânico acionado no Guarita',
        created_at: HOJE_UTC(16),
        visto_em: null,
        visto_por: null,
      },
    ]);
    const todos = await m.ctrl.alertas(undefined, TOKEN_OPERADORA);
    expect(todos.map((a: any) => a.id)).toEqual([2, 1]);
  });

  it('visto grava visto_em e visto_por "Central: <nome>"; alerta de condomínio sem central → 404', async () => {
    const m = montar();
    await expect(m.ctrl.alertaVisto(1, TOKEN_OPERADORA)).resolves.toEqual({ ok: true });
    const a = m.tabelas['guarita_Alertas'].find((x: any) => x.id === 1);
    expect(a.visto_por).toBe('Central: Olga Operadora');
    expect(a.visto_em).toEqual(new Date(AGORA));
    // Já visto: não troca quem viu.
    await m.ctrl.alertaVisto(2, TOKEN_OPERADORA);
    expect(m.tabelas['guarita_Alertas'].find((x: any) => x.id === 2).visto_por).toBe('Carlos Porteiro');
    await expect(m.ctrl.alertaVisto(3, TOKEN_OPERADORA)).rejects.toMatchObject({ status: 404 });
    expect(m.tabelas['guarita_Alertas'].find((x: any) => x.id === 3).visto_em).toBeNull();
  });
});

it('OPERADORA usada nos testes é a do token', () => {
  expect(OPERADORA).toEqual({ uid: TOKEN_OPERADORA.sub, nome: TOKEN_OPERADORA.nome });
});

describe('central — só chamadas encaminhadas para a central (destino)', () => {
  it('chamada da janela local (ou antiga, sem destino) não está na fila e o operador não atende, abre, encerra nem vê o contexto', async () => {
    for (const destino of ['local', null]) {
      const m = montar({ porteiroOnline: true });
      const id = await naPortaria(m, { destino });
      await expect(m.ctrl.fila(TOKEN_OPERADORA)).resolves.toEqual([]);
      await expect(m.ctrl.atender(id, TOKEN_OPERADORA)).rejects.toMatchObject({ status: 403 });
      await expect(m.ctrl.encerrar(id, TOKEN_OPERADORA)).rejects.toMatchObject({ status: 403 });
      await expect(m.ctrl.contexto(id, TOKEN_OPERADORA)).rejects.toMatchObject({ status: 403 });
      // Nem forjando o "atendida" pelo serviço de voz o operador abre o portão da chamada local.
      await m.nucleo.evento(id, { evento: 'atendida', papel: 'central', uid: 5 });
      linha(m, id).id_operador_central = null;
      await expect(m.ctrl.abrir(id, { codigo: 'entrega' }, TOKEN_OPERADORA)).rejects.toMatchObject({ status: 403 });
      expect(m.voz.encerrar).not.toHaveBeenCalled();
      expect(m.facial.abrirDispositivoInterno).not.toHaveBeenCalled();
      // O porteiro do prédio segue atendendo.
      const outra = await naPortaria(m, { destino });
      await expect(m.acoes.atender(outra, PORTEIRO)).resolves.toMatchObject({ id: outra });
    }
  });

  it('chamada da janela da central: está na fila, o operador atende, vê o contexto e o porteiro online também pode atender', async () => {
    const m = montar({ porteiroOnline: true });
    const id = await naPortaria(m, { destino: 'central' });
    await expect(m.ctrl.fila(TOKEN_OPERADORA)).resolves.toEqual([expect.objectContaining({ id })]);
    await expect(m.ctrl.contexto(id, TOKEN_OPERADORA)).resolves.toMatchObject({ unidade: 'Bloco A · Apto 106' });
    const outra = await naPortaria(m, { destino: 'central' });
    await expect(m.acoes.atender(outra, PORTEIRO)).resolves.toMatchObject({ id: outra });
    await expect(m.ctrl.atender(id, TOKEN_OPERADORA)).resolves.toMatchObject({ id });
  });

  it('o núcleo grava o destino ao levar a chamada para a portaria: sem porteiro (salvaguarda) → central; porteiro online sem faixa da central → local', async () => {
    const semPorteiro = montar({ porteiroOnline: false });
    const r1 = await semPorteiro.nucleo.novaChamadaFacial('fac-12', '106');
    if (!r1.ok) throw new Error('chamada não criada');
    await semPorteiro.nucleo.evento(r1.id, { evento: 'toque_esgotado' });
    expect(linha(semPorteiro, r1.id)).toMatchObject({ estado: 'portaria', destino: 'central' });
    await expect(semPorteiro.ctrl.fila(TOKEN_OPERADORA)).resolves.toEqual([expect.objectContaining({ id: r1.id })]);

    const comPorteiro = montar({ porteiroOnline: true });
    const r2 = await comPorteiro.nucleo.novaChamadaFacial('fac-12', '106');
    if (!r2.ok) throw new Error('chamada não criada');
    await comPorteiro.nucleo.evento(r2.id, { evento: 'toque_esgotado' });
    expect(linha(comPorteiro, r2.id)).toMatchObject({ estado: 'portaria', destino: 'local' });
    await expect(comPorteiro.ctrl.fila(TOKEN_OPERADORA)).resolves.toEqual([]);
  });

  it('faixa da central na agenda com porteiro online: toca nos dois e o destino fica central', async () => {
    const m = montar({ porteiroOnline: true });
    // 27/11/2026 é sexta (5); 14:05 em Brasília.
    m.tabelas['portaria_Agenda'].push({ id: 1, id_condominio: 1, dia_semana: 5, inicio: '08:00', fim: '18:00', destino: 'central' });
    const r = await m.nucleo.novaChamadaFacial('fac-12', '106');
    if (!r.ok) throw new Error('chamada não criada');
    await m.nucleo.evento(r.id, { evento: 'toque_esgotado' });
    await m.nucleo.ociosos();
    expect(linha(m, r.id).destino).toBe('central');
    expect(m.realtime.emitirPortaria).toHaveBeenCalledWith(1, 'interfone:chamada', expect.objectContaining({ id: r.id }));
    expect(m.realtime.emitirCentral).toHaveBeenCalledWith('interfone:chamada', expect.objectContaining({ id: r.id }));
  });

  it('ligação feita pelo operador: destino central, contexto enquanto em curso e encerrar pelo operador', async () => {
    const m = montar();
    const d = await m.ctrl.ligar({ id_apartamento: 100 }, TOKEN_OPERADORA);
    expect(linha(m, d.id)).toMatchObject({ destino: 'central', id_operador_central: 5, estado: 'chamando' });
    await expect(m.ctrl.contexto(d.id, TOKEN_OPERADORA)).resolves.toMatchObject({ unidade: 'Bloco A · Apto 106', moradores: ['Ana', 'Bruno'] });
    // Outro operador não vê a ligação que não é dele e nem foi para a fila (estado chamando).
    await expect(m.ctrl.contexto(d.id, { ...TOKEN_OPERADORA, sub: 6, nome: 'Outro' })).rejects.toMatchObject({ status: 403 });
    await m.nucleo.evento(d.id, { evento: 'atendida', papel: 'morador', uid: 7 });
    await expect(m.ctrl.contexto(d.id, TOKEN_OPERADORA)).resolves.toMatchObject({ unidade: 'Bloco A · Apto 106' });
    await expect(m.ctrl.encerrar(d.id, TOKEN_OPERADORA)).resolves.toEqual({ ok: true });
    linha(m, d.id).estado = 'encerrada';
    await expect(m.ctrl.contexto(d.id, TOKEN_OPERADORA)).rejects.toMatchObject({ status: 403 });
  });

  it('ligação do app para a portaria nasce com destino local', async () => {
    const m = montar({ porteiroOnline: true });
    await m.acoes.ligarPortaria({ papel: 'morador', uid: 7, nome: 'Ana Maria Souza' }, 100);
    expect(m.tabelas['interfone_Chamadas'][0]).toMatchObject({ tipo: 'unidade_portaria', estado: 'portaria', destino: 'local' });
    await expect(m.ctrl.fila(TOKEN_OPERADORA)).resolves.toEqual([]);
  });

  it('visitante discou a portaria em condomínio da central sem porteiro: facial_portaria nasce com destino central', async () => {
    const m = montar({ porteiroOnline: false });
    const r = await m.nucleo.novaChamadaFacial('fac-12', '0');
    if (!r.ok) throw new Error('chamada não criada');
    expect(linha(m, r.id)).toMatchObject({ tipo: 'facial_portaria', estado: 'portaria', destino: 'central' });
  });
});

describe('central — histórico só de condomínios ativos com central', () => {
  it('condomínio desativado (mesmo com central) não entra no histórico', async () => {
    const m = montar();
    const id = await naPortaria(m, { cond: 3, apto: null, facial: null, created_at: HOJE_UTC(15) });
    await m.nucleo.evento(id, { evento: 'atendida', papel: 'central', uid: 5 });
    await expect(m.ctrl.historico('2026-11-27', TOKEN_OPERADORA)).resolves.toEqual([]);
  });
});

describe('central — pedido de autorização ao morador', () => {
  async function atendidaPelaOperadora(m: M, o: Parameters<typeof naPortaria>[1] = {}) {
    const id = await naPortaria(m, { foto: 'interfone/fotos/9.jpg', ...o });
    await m.nucleo.evento(id, { evento: 'atendida', papel: 'central', uid: 5 });
    return id;
  }

  it('operador que atendeu pede ao morador: PedidoResumo, push aos moradores da unidade e origem central', async () => {
    const m = montar();
    const id = await atendidaPelaOperadora(m);
    const r = await m.ctrl.pedido(id, { nome: 'Rodrigo', motivo: 'Visita', tipo: 'visita' }, TOKEN_OPERADORA);
    await m.nucleo.ociosos();
    expect(r).toEqual({
      id: expect.any(Number),
      estado: 'pendente',
      nome_falado: 'Rodrigo',
      motivo: 'Visita',
      tipo: 'visita',
      mensagem: null,
      respondido_por_nome: null,
      respondido_em: null,
      portao_aberto: false,
    });
    expect(m.tabelas['interfone_Pedidos'][0]).toMatchObject({ id_chamada: id, id_apartamento: 100, origem: 'central', foto: 'interfone/fotos/9.jpg' });
    expect(m.push.pedido).toHaveBeenCalledWith(r.id, [7, 8], expect.objectContaining({ id_chamada: id, condominio: 'Residencial Central' }));
    expect(m.realtime.emitirCentral).toHaveBeenCalledWith('interfone:pedido', expect.objectContaining({ id: r.id, id_chamada: id, id_condominio: 1 }));
  });

  it('facial_portaria: o operador escolhe a unidade (obrigatória, do mesmo condomínio)', async () => {
    const m = montar();
    const id = await atendidaPelaOperadora(m, { tipo: 'facial_portaria', apto: null });
    await expect(m.ctrl.pedido(id, { nome: 'Rodrigo', tipo: 'entrega' }, TOKEN_OPERADORA)).rejects.toMatchObject({ status: 400 });
    await expect(m.ctrl.pedido(id, { nome: 'Rodrigo', tipo: 'entrega', id_apartamento: 900 }, TOKEN_OPERADORA)).rejects.toMatchObject({ status: 403 });
    await expect(m.ctrl.pedido(id, { nome: 'Rodrigo', tipo: 'entrega', id_apartamento: 'x' as any }, TOKEN_OPERADORA)).rejects.toMatchObject({ status: 400 });
    const r = await m.ctrl.pedido(id, { nome: 'Rodrigo', tipo: 'entrega', id_apartamento: 200 }, TOKEN_OPERADORA);
    await m.nucleo.ociosos();
    expect(m.tabelas['interfone_Pedidos'].find((p: any) => p.id === r.id).id_apartamento).toBe(200);
    expect(m.push.pedido).toHaveBeenCalledWith(r.id, [9], expect.anything());
  });

  it('chamada só na fila (não atendida), atendida por outra pessoa, encerrada, sem central ou de outro destino → 403 sem criar pedido', async () => {
    const m = montar();
    const naFila = await naPortaria(m);
    await expect(m.ctrl.pedido(naFila, { nome: 'R', tipo: 'visita' }, TOKEN_OPERADORA)).rejects.toMatchObject({ status: 403 });
    const doPorteiro = await naPortaria(m);
    await m.nucleo.evento(doPorteiro, { evento: 'atendida', papel: 'portaria', uid: 3 });
    await expect(m.ctrl.pedido(doPorteiro, { nome: 'R', tipo: 'visita' }, TOKEN_OPERADORA)).rejects.toMatchObject({ status: 403 });
    const outroOperador = await naPortaria(m);
    await m.nucleo.evento(outroOperador, { evento: 'atendida', papel: 'central', uid: 6 });
    await expect(m.ctrl.pedido(outroOperador, { nome: 'R', tipo: 'visita' }, TOKEN_OPERADORA)).rejects.toMatchObject({ status: 403 });
    const fora = await naPortaria(m, { cond: 2 });
    await expect(m.ctrl.pedido(fora, { nome: 'R', tipo: 'visita' }, TOKEN_OPERADORA)).rejects.toMatchObject({ status: 403 });
    const local = await naPortaria(m, { destino: 'local' });
    await expect(m.ctrl.pedido(local, { nome: 'R', tipo: 'visita' }, TOKEN_OPERADORA)).rejects.toMatchObject({ status: 403 });
    const dela = await atendidaPelaOperadora(m);
    linha(m, dela).estado = 'encerrada';
    linha(m, dela).encerrada_em = new Date(AGORA);
    await expect(m.ctrl.pedido(dela, { nome: 'R', tipo: 'visita' }, TOKEN_OPERADORA)).rejects.toMatchObject({ status: 403 });
    await expect(m.ctrl.pedido(999, { nome: 'R', tipo: 'visita' }, TOKEN_OPERADORA)).rejects.toMatchObject({ status: 404 });
    expect(m.tabelas['interfone_Pedidos']).toHaveLength(0);
    expect(m.push.pedido).not.toHaveBeenCalled();
  });

  it('corpo inválido → 400 (nome vazio, tipo desconhecido, sem corpo)', async () => {
    const m = montar();
    const id = await atendidaPelaOperadora(m);
    await expect(m.ctrl.pedido(id, { nome: '', tipo: 'visita' }, TOKEN_OPERADORA)).rejects.toMatchObject({ status: 400 });
    await expect(m.ctrl.pedido(id, { nome: 'R', tipo: 'festa' as any }, TOKEN_OPERADORA)).rejects.toMatchObject({ status: 400 });
    await expect(m.ctrl.pedido(id, undefined, TOKEN_OPERADORA)).rejects.toMatchObject({ status: 400 });
    expect(m.tabelas['interfone_Pedidos']).toHaveLength(0);
  });

  it('ligação que o operador fez para a unidade (sem portão): pode pedir; autorizar não abre nada', async () => {
    const m = montar();
    const { id } = await m.ctrl.ligar({ id_apartamento: 100 }, TOKEN_OPERADORA);
    await m.nucleo.ociosos();
    const r = await m.ctrl.pedido(id, { nome: 'Rodrigo', tipo: 'servico' }, TOKEN_OPERADORA);
    await expect(m.pedidos.responder(r.id, 7, 'autorizar')).resolves.toMatchObject({ estado: 'autorizado', portao_aberto: false });
    expect(m.facial.abrirDispositivoInterno).not.toHaveBeenCalled();
  });

  it('contexto traz o último pedido da chamada, com o primeiro nome de quem respondeu e a mensagem', async () => {
    const m = montar();
    const id = await atendidaPelaOperadora(m);
    await expect(m.ctrl.contexto(id, TOKEN_OPERADORA)).resolves.toMatchObject({ pedido: null });
    const r = await m.ctrl.pedido(id, { nome: 'Rodrigo', tipo: 'entrega' }, TOKEN_OPERADORA);
    await expect(m.ctrl.contexto(id, TOKEN_OPERADORA)).resolves.toMatchObject({ pedido: { id: r.id, estado: 'pendente' } });
    await m.pedidos.responder(r.id, 7, 'negar', 'Deixe na portaria');
    const ctx = await m.ctrl.contexto(id, TOKEN_OPERADORA);
    expect(ctx.pedido).toMatchObject({ id: r.id, estado: 'negado', mensagem: 'Deixe na portaria', respondido_por_nome: 'Ana', portao_aberto: false });
    expect(JSON.stringify(ctx)).not.toContain('Souza');
  });
});
