// Correções da revisão independente (27/11): origem atrasada, retentativas,
// desligamento, reconexão da ARI, vídeo da ponte, portaria pendente e DTMF.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarServico } from '../src/servico.js';
import { assinarTokenVoz } from '../src/token.js';

const SEGREDO = 'segredo-de-teste-com-32-caracteres!!';
const silencio = { info() {}, warn() {}, error() {} };
const tick = () => new Promise((r) => setImmediate(r));

function ariFalso() {
  const ops = [];
  let ini = null;
  let fim = null;
  let pontes = 0;
  const ari = {
    ops,
    falharPonte: false,
    aoIniciar(fn) { ini = fn; },
    aoFim(fn) { fim = fn; },
    async ring(c) { ops.push(['ring', c]); },
    async answer(c) { ops.push(['answer', c]); },
    async hangup(c, m) { ops.push(['hangup', c, m]); },
    async tocar(c, media) { ops.push(['tocar', c, media]); },
    async criarPonte() {
      if (ari.falharPonte) throw new Error('sem ponte');
      pontes += 1; ops.push(['criarPonte', `p${pontes}`]); return `p${pontes}`;
    },
    async adicionarNaPonte(p, canais) { ops.push(['adicionarNaPonte', p, canais]); },
    async definirVideo(p, c) { ops.push(['definirVideo', p, c]); },
    async tocarNaPonte(p, media) { ops.push(['tocarNaPonte', p, media]); },
    async destruirPonte(p) { ops.push(['destruirPonte', p]); },
    async originar(o) { ops.push(['originar', o]); },
    async enviarDtmf(c, d) { ops.push(['enviarDtmf', c, d]); },
    iniciar: (canal, args) => ini({ canal, args }),
    fim: (canal) => fim({ canal }),
    de: (nome) => ops.filter((o) => o[0] === nome),
  };
  return ari;
}

function apiFalsa(over = {}) {
  const api = {
    chamadas: [],
    proximo: 77,
    async novaChamada(conta, numero) {
      api.chamadas.push(['novaChamada', conta, numero]);
      return { ok: true, id: api.proximo++, toque_s: 30, monitores: [] };
    },
    async chamada(id) {
      api.chamadas.push(['chamada', id]);
      return { id, tipo: 'facial_unidade', estado: 'chamando', toque_s: 30, toque_portaria_s: 45, monitores: [] };
    },
    async evento(id, ev) { api.chamadas.push(['evento', id, ev]); return { proximo: 'encerrar' }; },
    ...over,
  };
  return api;
}

function apiOrigem(tipo = 'portaria_unidade') {
  const api = apiFalsa({
    async chamada(id) {
      api.chamadas.push(['chamada', id]);
      return { id, tipo, estado: tipo === 'unidade_portaria' ? 'portaria' : 'chamando', toque_s: 30, toque_portaria_s: 45, monitores: [] };
    },
  });
  return api;
}

function temporizadorFalso() {
  let seq = 0;
  const ativos = new Map();
  return {
    ativos,
    agendar(fn, ms) { seq += 1; ativos.set(seq, { fn, ms }); return seq; },
    cancelar(h) { ativos.delete(h); },
    disparar(ms) {
      for (const [h, t] of [...ativos]) if (t.ms === ms) { ativos.delete(h); t.fn(); }
    },
    tem: (ms) => [...ativos.values()].some((t) => t.ms === ms),
  };
}

function montar({ api = apiFalsa(), agora = 1_800_000_000_000 } = {}) {
  const ari = ariFalso();
  const temporizador = temporizadorFalso();
  const relogio = () => relogio.agora;
  relogio.agora = agora;
  const servico = criarServico({ ari, api, segredo: SEGREDO, relogio, temporizador, log: silencio });
  return { ari, api, temporizador, relogio, servico };
}

const token = (claims, agoraMs = 1_800_000_000_000) =>
  assinarTokenVoz({ nome: 'X', ...claims }, SEGREDO, Math.floor(agoraMs / 1000));
const eventos = (api) => api.chamadas.filter((c) => c[0] === 'evento').map((c) => c[2]);

test('quem atende antes da origem espera até ela chegar e entra na ponte', async () => {
  const { ari, api, servico, temporizador } = montar({ api: apiOrigem() });
  ari.iniciar('app1', ['entrar', token({ cid: 90, papel: 'morador', uid: 42 })]);
  await servico.ocioso();
  assert.equal(ari.de('hangup').length, 0, 'não desliga de cara');
  assert.ok(temporizador.tem(10_000), 'espera 10 s');
  ari.iniciar('web1', ['entrar', token({ cid: 90, papel: 'origem', uid: 3 })]);
  await servico.ocioso();
  assert.deepEqual(ari.de('adicionarNaPonte')[0][2], ['web1', 'app1']);
  assert.deepEqual(eventos(api)[0], { evento: 'atendida', papel: 'morador', uid: 42 });
  assert.ok(!temporizador.tem(10_000), 'espera cancelada');
});

test('quem espera a origem é desligado se ela não chega em 10 s', async () => {
  const { ari, servico, temporizador } = montar({ api: apiOrigem() });
  ari.iniciar('app1', ['entrar', token({ cid: 90, papel: 'morador', uid: 42 })]);
  await servico.ocioso();
  temporizador.disparar(10_000);
  await servico.ocioso();
  assert.deepEqual(ari.ops, [['hangup', 'app1', 'normal']]);
});

test('quem espera e desliga sai da fila; a origem que chega depois não junta ninguém', async () => {
  const { ari, servico, temporizador } = montar({ api: apiOrigem() });
  ari.iniciar('app1', ['entrar', token({ cid: 90, papel: 'morador', uid: 42 })]);
  await servico.ocioso();
  ari.fim('app1');
  assert.ok(!temporizador.tem(10_000));
  ari.iniciar('web1', ['entrar', token({ cid: 90, papel: 'origem', uid: 3 })]);
  await servico.ocioso();
  assert.equal(ari.de('adicionarNaPonte').length, 0);
});

test('origem recusada pela API derruba quem esperava por ela', async () => {
  const api = apiFalsa({ async chamada(id) { return { id, tipo: 'portaria_unidade', estado: 'encerrada', toque_s: 30 }; } });
  const { ari, servico } = montar({ api });
  ari.iniciar('app1', ['entrar', token({ cid: 90, papel: 'morador', uid: 42 })]);
  await servico.ocioso();
  ari.iniciar('web1', ['entrar', token({ cid: 90, papel: 'origem', uid: 3 })]);
  await servico.ocioso();
  assert.deepEqual(ari.de('hangup').map((h) => h[1]).sort(), ['app1', 'web1']);
});

test('morador que atende antes de o serviço conhecer a chamada do facial espera por ela', async () => {
  let liberar;
  const api = apiFalsa({ novaChamada: () => new Promise((r) => { liberar = () => r({ ok: true, id: 77, toque_s: 30, monitores: [] }); }) });
  const { ari, servico } = montar({ api });
  ari.iniciar('fac1', ['facial', 'fac-12', '106']);
  await tick();
  ari.iniciar('app1', ['entrar', token({ cid: 77, papel: 'morador', uid: 42 })]);
  await tick();
  liberar();
  await servico.ocioso();
  assert.deepEqual(ari.de('adicionarNaPonte')[0][2], ['fac1', 'app1']);
});

test('ponte de facial usa o facial como fonte de vídeo', async () => {
  const { ari, servico } = montar();
  ari.iniciar('fac1', ['facial', 'fac-12', '106']);
  await servico.ocioso();
  ari.iniciar('app1', ['entrar', token({ cid: 77, papel: 'morador', uid: 42 })]);
  await servico.ocioso();
  assert.deepEqual(ari.de('definirVideo'), [['definirVideo', 'p1', 'fac1']]);
});

test('ponte de portaria_unidade não mexe no vídeo; erro no vídeo não derruba', async () => {
  const { ari, servico } = montar({ api: apiOrigem() });
  ari.iniciar('web1', ['entrar', token({ cid: 90, papel: 'origem', uid: 3 })]);
  await servico.ocioso();
  ari.iniciar('app1', ['entrar', token({ cid: 90, papel: 'morador', uid: 42 })]);
  await servico.ocioso();
  assert.equal(ari.de('definirVideo').length, 0);

  const m = montar();
  m.ari.definirVideo = async () => { throw new Error('sem softmix'); };
  m.ari.iniciar('fac1', ['facial', 'fac-12', '106']);
  await m.servico.ocioso();
  m.ari.iniciar('app1', ['entrar', token({ cid: 77, papel: 'morador', uid: 42 })]);
  await m.servico.ocioso();
  assert.deepEqual(eventos(m.api), [{ evento: 'atendida', papel: 'morador', uid: 42 }]);
});

test('ponte falha: não manda atendida, só encerrada falha', async () => {
  const { ari, api, servico, temporizador } = montar();
  ari.falharPonte = true;
  ari.iniciar('fac1', ['facial', 'fac-12', '106']);
  await servico.ocioso();
  ari.iniciar('app1', ['entrar', token({ cid: 77, papel: 'morador', uid: 42 })]);
  await servico.ocioso();
  assert.deepEqual(eventos(api), [{ evento: 'encerrada', resultado: 'falha', duracao_s: 0 }]);
  assert.equal(temporizador.ativos.size, 0, 'sem aviso/fim agendados');
});

test('encerrada é repetida (0,5 s, 1 s, 2 s) quando a API falha', async () => {
  let falhas = 3;
  const api = apiFalsa({
    async evento(id, ev) {
      api.chamadas.push(['evento', id, ev]);
      if (ev.evento === 'encerrada' && falhas-- > 0) throw new Error('EB reiniciando');
      return {};
    },
  });
  const { ari, servico, temporizador } = montar({ api });
  ari.iniciar('fac1', ['facial', 'fac-12', '106']);
  await servico.ocioso();
  ari.fim('fac1');
  for (const ms of [500, 1000, 2000]) {
    await tick(); await tick();
    assert.ok(temporizador.tem(ms), `espera ${ms}`);
    temporizador.disparar(ms);
  }
  await servico.ocioso();
  assert.equal(eventos(api).filter((e) => e.evento === 'encerrada').length, 4);
});

test('atendida também é repetida', async () => {
  let falhas = 1;
  const api = apiFalsa({
    async evento(id, ev) {
      api.chamadas.push(['evento', id, ev]);
      if (ev.evento === 'atendida' && falhas-- > 0) throw new Error('fora');
      return {};
    },
  });
  const { ari, servico, temporizador } = montar({ api });
  ari.iniciar('fac1', ['facial', 'fac-12', '106']);
  await servico.ocioso();
  ari.iniciar('app1', ['entrar', token({ cid: 77, papel: 'morador', uid: 42 })]);
  await tick(); await tick(); await tick();
  temporizador.disparar(500);
  await servico.ocioso();
  assert.equal(eventos(api).filter((e) => e.evento === 'atendida').length, 2);
});

test('encerrada desiste depois de 4 tentativas', async () => {
  const api = apiFalsa({ async evento(id, ev) { api.chamadas.push(['evento', id, ev]); throw new Error('fora'); } });
  const { ari, servico, temporizador } = montar({ api });
  ari.iniciar('fac1', ['facial', 'fac-12', '106']);
  await servico.ocioso();
  ari.fim('fac1');
  for (const ms of [500, 1000, 2000]) { await tick(); await tick(); temporizador.disparar(ms); }
  await servico.ocioso();
  assert.equal(eventos(api).length, 4);
  assert.equal(temporizador.ativos.size, 0);
});

test('desligamento: cada chamada ativa vira encerrada falha', async () => {
  const { ari, api, servico, relogio } = montar();
  ari.iniciar('fac1', ['facial', 'fac-12', '106']);
  ari.iniciar('fac2', ['facial', 'fac-13', '107']);
  await servico.ocioso();
  ari.iniciar('app1', ['entrar', token({ cid: 77, papel: 'morador', uid: 42 })]);
  await servico.ocioso();
  relogio.agora += 20_000;
  await servico.encerrarTodasPorFalha({ tetoMs: 3000 });
  const enc = eventos(api).filter((e) => e.evento === 'encerrada');
  assert.deepEqual(enc.map((e) => e.resultado), ['falha', 'falha']);
  assert.ok(enc.some((e) => e.duracao_s === 20));
  assert.equal(servico.ativas(), 0);
});

test('desligamento respeita o teto mesmo com a API presa', async () => {
  const api = apiFalsa({ evento: () => new Promise(() => {}) });
  const { ari, servico, temporizador } = montar({ api });
  ari.iniciar('fac1', ['facial', 'fac-12', '106']);
  await servico.ocioso();
  const fim = servico.encerrarTodasPorFalha({ tetoMs: 3000 });
  await tick();
  assert.ok(temporizador.tem(3000));
  temporizador.disparar(3000);
  await fim;
});

test('ARI reconectada: chamada cujo canal sumiu é encerrada como falha', async () => {
  const { ari, api, servico } = montar();
  ari.iniciar('fac1', ['facial', 'fac-12', '106']);
  ari.iniciar('fac2', ['facial', 'fac-13', '107']);
  await servico.ocioso();
  assert.equal(servico.conferirCanais(new Set(['fac2'])), 1);
  await servico.ocioso();
  assert.deepEqual(eventos(api), [{ evento: 'encerrada', resultado: 'falha', duracao_s: 0 }]);
  assert.equal(servico.ativas(), 1);
});

test('ARI reconectada: participante que sumiu na conversa também encerra', async () => {
  const { ari, api, servico } = montar();
  ari.iniciar('fac1', ['facial', 'fac-12', '106']);
  await servico.ocioso();
  ari.iniciar('app1', ['entrar', token({ cid: 77, papel: 'morador', uid: 42 })]);
  await servico.ocioso();
  assert.equal(servico.conferirCanais(new Set(['fac1'])), 1);
  await servico.ocioso();
  assert.equal(eventos(api).at(-1).resultado, 'falha');
});

test('portaria pendente só vale para o próprio id', async () => {
  let liberar;
  const api = apiFalsa({ novaChamada: () => new Promise((r) => { liberar = () => r({ ok: true, id: 82, toque_s: 30, monitores: [] }); }) });
  const { ari, servico, temporizador } = montar({ api });
  ari.iniciar('fac1', ['facial', 'fac-12', '106']);
  await tick();
  assert.equal(servico.forcarPortaria(81), true);
  liberar();
  await servico.ocioso();
  assert.ok(!temporizador.tem(45_000), 'não aplicou o pedido do 81 na chamada 82');
});

test('dtmf só para facial já atendido', async () => {
  const { ari, servico } = montar();
  ari.iniciar('fac1', ['facial', 'fac-12', '106']);
  await servico.ocioso();
  assert.equal(await servico.dtmf(77, '1'), false, 'ainda chamando');
  ari.iniciar('app1', ['entrar', token({ cid: 77, papel: 'morador', uid: 42 })]);
  await servico.ocioso();
  assert.equal(await servico.dtmf(77, '1'), true);

  const m = montar({ api: apiOrigem() });
  m.ari.iniciar('web1', ['entrar', token({ cid: 90, papel: 'origem', uid: 3 })]);
  await m.servico.ocioso();
  m.ari.iniciar('app1', ['entrar', token({ cid: 90, papel: 'morador', uid: 42 })]);
  await m.servico.ocioso();
  assert.equal(await m.servico.dtmf(90, '1'), false, 'portaria_unidade não tem facial');
  assert.equal(m.ari.de('enviarDtmf').length, 0);
});

// ------------------------------------------------- re-revisão

const erroHttp = (status) => Object.assign(new Error(`API respondeu ${status}`), { status });

test('evento com 4xx da API não é repetido', async () => {
  const api = apiFalsa({ async evento(id, ev) { api.chamadas.push(['evento', id, ev]); throw erroHttp(409); } });
  const { ari, servico, temporizador } = montar({ api });
  ari.iniciar('fac1', ['facial', 'fac-12', '106']);
  await servico.ocioso();
  ari.fim('fac1');
  await servico.ocioso();
  assert.equal(eventos(api).length, 1);
  assert.ok(!temporizador.tem(500), 'sem nova tentativa');
});

test('evento com 5xx ou erro de rede é repetido', async () => {
  let n = 0;
  const api = apiFalsa({
    async evento(id, ev) {
      api.chamadas.push(['evento', id, ev]);
      n += 1;
      if (n === 1) throw erroHttp(503);
      if (n === 2) throw new Error('fetch failed');
      return {};
    },
  });
  const { ari, servico, temporizador } = montar({ api });
  ari.iniciar('fac1', ['facial', 'fac-12', '106']);
  await servico.ocioso();
  ari.fim('fac1');
  await tick(); await tick();
  temporizador.disparar(500);
  await tick(); await tick();
  temporizador.disparar(1000);
  await servico.ocioso();
  assert.equal(eventos(api).length, 3);
});

test('quem entra numa chamada que acabou de encerrar é desligado na hora', async () => {
  const { ari, servico, temporizador } = montar();
  ari.iniciar('fac1', ['facial', 'fac-12', '106']);
  await servico.ocioso();
  ari.fim('fac1');
  await servico.ocioso();
  assert.equal(servico.ativas(), 0);
  ari.iniciar('app1', ['entrar', token({ cid: 77, papel: 'morador', uid: 42 })]);
  await servico.ocioso();
  assert.deepEqual(ari.de('hangup').at(-1), ['hangup', 'app1', 'normal']);
  assert.ok(!temporizador.tem(10_000), 'não esperou');
});

test('quem espera é derrubado na hora quando a origem daquele id não consegue ser criada', async () => {
  const api = apiFalsa({ async chamada() { throw new Error('API fora'); } });
  const { ari, servico, temporizador } = montar({ api });
  ari.iniciar('app1', ['entrar', token({ cid: 90, papel: 'morador', uid: 42 })]);
  await servico.ocioso();
  ari.iniciar('web1', ['entrar', token({ cid: 90, papel: 'origem', uid: 3 })]);
  await servico.ocioso();
  assert.deepEqual(ari.de('hangup').map((h) => h[1]).sort(), ['app1', 'web1']);
  assert.ok(!temporizador.tem(10_000));
});

test('conferirCanais ignora chamadas criadas depois do início da consulta', async () => {
  const { ari, api, servico } = montar();
  ari.iniciar('fac1', ['facial', 'fac-12', '106']);
  await servico.ocioso();
  const marco = servico.marco();
  ari.iniciar('fac2', ['facial', 'fac-13', '107']);
  await servico.ocioso();
  // a lista veio antes de fac2 existir: só fac1 é conhecido e está vivo
  assert.equal(servico.conferirCanais(new Set(['fac1']), marco), 0);
  await servico.ocioso();
  assert.equal(eventos(api).length, 0);
  assert.equal(servico.ativas(), 2);
});
