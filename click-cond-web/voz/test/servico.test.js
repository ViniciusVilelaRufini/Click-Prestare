import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarServico } from '../src/servico.js';
import { assinarTokenVoz } from '../src/token.js';

const SEGREDO = 'segredo-de-teste-com-32-caracteres!!';
const silencio = { info() {}, warn() {}, error() {} };

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
    async tocarNaPonte(p, media) { ops.push(['tocarNaPonte', p, media]); },
    async destruirPonte(p) { ops.push(['destruirPonte', p]); },
    async originar(o) { ops.push(['originar', o]); },
    async enviarDtmf(c, d) { ops.push(['enviarDtmf', c, d]); },
    // Disparo de eventos pelo teste:
    iniciar: (canal, args) => ini({ canal, args }),
    fim: (canal) => fim({ canal }),
    de: (nome) => ops.filter((o) => o[0] === nome),
  };
  return ari;
}

function apiFalsa(over = {}) {
  const chamadas = [];
  const api = {
    chamadas,
    async novaChamada(conta, numero) {
      chamadas.push(['novaChamada', conta, numero]);
      return { ok: true, id: 77, toque_s: 30, monitores: [] };
    },
    async chamada(id) {
      chamadas.push(['chamada', id]);
      return { id, tipo: 'facial_unidade', estado: 'chamando', toque_s: 30, toque_portaria_s: 45, monitores: [] };
    },
    async evento(id, ev) { chamadas.push(['evento', id, ev]); return { proximo: 'encerrar' }; },
    ...over,
  };
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

test('facial com número que não existe ouve a mensagem e desliga sem criar chamada', async () => {
  const api = apiFalsa({
    async novaChamada(conta, numero) { api.chamadas.push(['novaChamada', conta, numero]); return { ok: false, motivo: 'nao_encontrado' }; },
  });
  const { ari, servico } = montar({ api });
  ari.iniciar('fac1', ['facial', 'fac-12', '999']);
  await servico.ocioso();
  assert.deepEqual(ari.ops, [
    ['answer', 'fac1'],
    ['tocar', 'fac1', 'sound:prestare/apto-nao-encontrado'],
    ['hangup', 'fac1', 'normal'],
  ]);
  assert.equal(servico.ativas(), 0);
  assert.equal(eventos(api).length, 0);
});

test('limite e indisponível tocam a mensagem certa; API fora = indisponível', async () => {
  for (const [resposta, som] of [
    [{ ok: false, motivo: 'limite' }, 'aguarde-para-chamar'],
    [{ ok: false, motivo: 'indisponivel' }, 'servico-indisponivel'],
    [null, 'servico-indisponivel'],
  ]) {
    const api = apiFalsa({ async novaChamada() { if (!resposta) throw new Error('fora'); return resposta; } });
    const { ari, servico } = montar({ api });
    ari.iniciar('fac1', ['facial', 'fac-12', '106']);
    await servico.ocioso();
    assert.deepEqual(ari.de('tocar')[0], ['tocar', 'fac1', `sound:prestare/${som}`]);
    assert.equal(ari.de('hangup').length, 1);
  }
});

test('número com caractere estranho não chega à API', async () => {
  const { ari, api, servico } = montar();
  ari.iniciar('fac1', ['facial', 'fac-12', '10#6']);
  await servico.ocioso();
  assert.equal(api.chamadas.length, 0);
  assert.deepEqual(ari.de('tocar')[0][2], 'sound:prestare/apto-nao-encontrado');
});

test('conta que não é de facial é desligada', async () => {
  const { ari, api, servico } = montar();
  ari.iniciar('x', ['facial', 'mon-3', '106']);
  await servico.ocioso();
  assert.equal(api.chamadas.length, 0);
  assert.deepEqual(ari.ops, [['hangup', 'x', 'normal']]);
});

test('token expirado ou inválido desliga', async () => {
  const { ari, servico } = montar();
  ari.iniciar('w1', ['entrar', token({ cid: 77, papel: 'morador', uid: 1 }, 1_800_000_000_000 - 200_000)]);
  ari.iniciar('w2', ['entrar', 'lixo']);
  ari.iniciar('w3', ['entrar']);
  await servico.ocioso();
  assert.deepEqual(ari.ops, [['hangup', 'w1', 'normal'], ['hangup', 'w2', 'normal'], ['hangup', 'w3', 'normal']]);
});

test('fluxo completo: facial chama, morador entra, ponte com 2 canais e evento atendida', async () => {
  const api = apiFalsa({
    async novaChamada(conta, numero) {
      api.chamadas.push(['novaChamada', conta, numero]);
      return { ok: true, id: 77, toque_s: 30, monitores: ['mon-5'] };
    },
  });
  const { ari, servico, temporizador } = montar({ api });
  ari.iniciar('fac1', ['facial', 'fac-12', '106']);
  await servico.ocioso();
  assert.deepEqual(api.chamadas.slice(0, 2), [['novaChamada', 'fac-12', '106'], ['chamada', 77]]);
  assert.deepEqual(ari.de('ring'), [['ring', 'fac1']]);
  const [, orig] = ari.de('originar')[0];
  assert.equal(orig.endpoint, 'PJSIP/mon-5');
  assert.equal(orig.appArgs, 'monitor,mon-5,77');
  assert.equal(orig.timeoutS, 30);
  assert.ok([...temporizador.ativos.values()].some((t) => t.ms === 30_000));

  ari.iniciar('app1', ['entrar', token({ cid: 77, papel: 'morador', uid: 42 })]);
  await servico.ocioso();
  assert.deepEqual(ari.de('answer'), [['answer', 'fac1'], ['answer', 'app1']]);
  assert.deepEqual(ari.de('adicionarNaPonte'), [['adicionarNaPonte', 'p1', ['fac1', 'app1']]]);
  assert.deepEqual(eventos(api), [{ evento: 'atendida', papel: 'morador', uid: 42 }]);
  // monitor que ainda tocava foi desligado
  assert.deepEqual(ari.de('hangup').map((h) => h[1]), [orig.canal]);
  // toque cancelado; aviso e fim agendados
  const ms = [...temporizador.ativos.values()].map((t) => t.ms).sort((a, b) => a - b);
  assert.deepEqual(ms, [150_000, 180_000]);

  // segundo aparelho é recusado
  ari.iniciar('app2', ['entrar', token({ cid: 77, papel: 'morador', uid: 43 })]);
  await servico.ocioso();
  assert.deepEqual(ari.de('hangup').at(-1), ['hangup', 'app2', 'busy']);

  // morador desliga: encerra tudo
  ari.fim('app1');
  await servico.ocioso();
  assert.deepEqual(eventos(api).at(-1), { evento: 'encerrada', resultado: 'atendida_morador', duracao_s: 0 });
  assert.ok(ari.de('hangup').some((h) => h[1] === 'fac1'));
  assert.deepEqual(ari.de('destruirPonte'), [['destruirPonte', 'p1']]);
  assert.equal(servico.ativas(), 0);
  assert.equal(temporizador.ativos.size, 0);
});

test('origem desliga durante o toque: evento encerrada cancelada', async () => {
  const { ari, api, servico, temporizador } = montar();
  ari.iniciar('fac1', ['facial', 'fac-12', '106']);
  await servico.ocioso();
  ari.fim('fac1');
  ari.fim('fac1'); // StasisEnd + ChannelDestroyed
  await servico.ocioso();
  assert.deepEqual(eventos(api), [{ evento: 'encerrada', resultado: 'cancelada', duracao_s: 0 }]);
  assert.equal(servico.ativas(), 0);
  assert.equal(temporizador.ativos.size, 0);
});

test('visitante desliga enquanto a API responde: chamada criada e cancelada em seguida', async () => {
  let liberar;
  const api = apiFalsa({
    novaChamada: () => new Promise((r) => { liberar = () => r({ ok: true, id: 80, toque_s: 30, monitores: [] }); }),
  });
  const { ari, servico } = montar({ api });
  ari.iniciar('fac1', ['facial', 'fac-12', '106']);
  await new Promise((r) => setImmediate(r));
  ari.fim('fac1');
  liberar();
  await servico.ocioso();
  assert.deepEqual(eventos(api), [{ evento: 'encerrada', resultado: 'cancelada', duracao_s: 0 }]);
  assert.equal(servico.ativas(), 0);
});

test('toque esgotado: API manda portaria, depois portaria atende', async () => {
  const api = apiFalsa({ async evento(id, ev) { api.chamadas.push(['evento', id, ev]); return ev.evento === 'toque_esgotado' ? { proximo: 'portaria' } : {}; } });
  const { ari, servico, temporizador } = montar({ api });
  ari.iniciar('fac1', ['facial', 'fac-12', '106']);
  await servico.ocioso();
  temporizador.disparar(30_000);
  await servico.ocioso();
  assert.deepEqual(eventos(api), [{ evento: 'toque_esgotado' }]);
  assert.ok([...temporizador.ativos.values()].some((t) => t.ms === 45_000));
  ari.iniciar('web1', ['entrar', token({ cid: 77, papel: 'portaria', uid: 3 })]);
  await servico.ocioso();
  assert.deepEqual(eventos(api).at(-1), { evento: 'atendida', papel: 'portaria', uid: 3 });
});

test('toque esgotado sem portaria: toca ninguém atendeu, desliga e registra não atendida', async () => {
  const { ari, api, servico, temporizador } = montar();
  ari.iniciar('fac1', ['facial', 'fac-12', '106']);
  await servico.ocioso();
  temporizador.disparar(30_000);
  await servico.ocioso();
  assert.deepEqual(ari.de('tocar'), [['tocar', 'fac1', 'sound:prestare/ninguem-atendeu']]);
  assert.deepEqual(eventos(api).at(-1), { evento: 'encerrada', resultado: 'nao_atendida', duracao_s: 0 });
  assert.equal(servico.ativas(), 0);
});

test('API fora no toque esgotado: encerra como não atendida', async () => {
  const api = apiFalsa({ async evento(id, ev) { api.chamadas.push(['evento', id, ev]); if (ev.evento === 'toque_esgotado') throw new Error('fora'); return {}; } });
  const { ari, servico, temporizador } = montar({ api });
  ari.iniciar('fac1', ['facial', 'fac-12', '106']);
  await servico.ocioso();
  temporizador.disparar(30_000);
  await servico.ocioso();
  assert.equal(eventos(api).at(-1).resultado, 'nao_atendida');
});

test('portaria forçada pelo controle antes da resposta da API (sem app na unidade)', async () => {
  let liberar;
  const api = apiFalsa({
    novaChamada: () => new Promise((r) => { liberar = () => r({ ok: true, id: 81, toque_s: 30, monitores: [] }); }),
  });
  const { ari, servico, temporizador } = montar({ api });
  ari.iniciar('fac1', ['facial', 'fac-12', '106']);
  await new Promise((r) => setImmediate(r));
  assert.equal(servico.forcarPortaria(81), true, 'aceita enquanto cria');
  liberar();
  await servico.ocioso();
  assert.ok([...temporizador.ativos.values()].some((t) => t.ms === 45_000));
  assert.equal(servico.forcarPortaria(999), false, 'desconhecida sem criação em curso');
});

test('monitor atende: entra na ponte sem answer no canal dele', async () => {
  const api = apiFalsa({ async novaChamada() { return { ok: true, id: 77, toque_s: 30, monitores: ['mon-5'] }; } });
  const { ari, servico } = montar({ api });
  ari.iniciar('fac1', ['facial', 'fac-12', '106']);
  await servico.ocioso();
  const canalMon = ari.de('originar')[0][1].canal;
  ari.iniciar(canalMon, ['monitor', 'mon-5', '77']);
  await servico.ocioso();
  assert.deepEqual(ari.de('answer'), [['answer', 'fac1']]);
  assert.deepEqual(ari.de('adicionarNaPonte')[0][2], ['fac1', canalMon]);
  assert.deepEqual(eventos(api)[0], { evento: 'atendida', papel: 'monitor', uid: 5 });
});

test('monitor desconhecido é desligado', async () => {
  const { ari, servico } = montar();
  ari.iniciar('m9', ['monitor', 'mon-5', '77']);
  await servico.ocioso();
  assert.deepEqual(ari.ops, [['hangup', 'm9', 'normal']]);
});

test('origem do console (portaria_unidade): cria pela API, toca de volta e liga monitores', async () => {
  const api = apiFalsa({
    async chamada(id) {
      api.chamadas.push(['chamada', id]);
      return { id, tipo: 'portaria_unidade', estado: 'chamando', toque_s: 30, toque_portaria_s: 45, monitores: ['mon-2'] };
    },
  });
  const { ari, servico, temporizador } = montar({ api });
  ari.iniciar('web1', ['entrar', token({ cid: 90, papel: 'origem', uid: 3 })]);
  await servico.ocioso();
  assert.deepEqual(ari.de('ring'), [['ring', 'web1']]);
  assert.equal(ari.de('originar')[0][1].endpoint, 'PJSIP/mon-2');
  assert.ok([...temporizador.ativos.values()].some((t) => t.ms === 30_000));
  // segunda origem para a mesma chamada é recusada
  ari.iniciar('web2', ['entrar', token({ cid: 90, papel: 'origem', uid: 3 })]);
  await servico.ocioso();
  assert.deepEqual(ari.de('hangup').at(-1), ['hangup', 'web2', 'normal']);
  // morador atende
  ari.iniciar('app1', ['entrar', token({ cid: 90, papel: 'morador', uid: 42 })]);
  await servico.ocioso();
  assert.deepEqual(ari.de('adicionarNaPonte')[0][2], ['web1', 'app1']);
  // ninguém atendendo não se aplica mais; console desliga
  ari.fim('web1');
  await servico.ocioso();
  assert.deepEqual(eventos(api).at(-1), { evento: 'encerrada', resultado: 'atendida_morador', duracao_s: 0 });
});

test('origem do app (unidade_portaria) começa em portaria; toque esgotado encerra sem perguntar à API', async () => {
  const api = apiFalsa({
    async chamada(id) {
      api.chamadas.push(['chamada', id]);
      return { id, tipo: 'unidade_portaria', estado: 'portaria', toque_s: 45, toque_portaria_s: 45, monitores: [] };
    },
  });
  const { ari, servico, temporizador } = montar({ api });
  ari.iniciar('app1', ['entrar', token({ cid: 91, papel: 'origem', uid: 42 })]);
  await servico.ocioso();
  assert.deepEqual(ari.de('ring'), [['ring', 'app1']]);
  temporizador.disparar(45_000);
  await servico.ocioso();
  assert.deepEqual(eventos(api), [{ evento: 'encerrada', resultado: 'nao_atendida', duracao_s: 0 }]);
  assert.equal(ari.de('tocar').length, 0, 'sem mensagem para o app');
});

test('origem para chamada encerrada ou de facial é desligada', async () => {
  for (const dados of [
    { id: 92, tipo: 'portaria_unidade', estado: 'encerrada', toque_s: 30 },
    { id: 92, tipo: 'facial_unidade', estado: 'chamando', toque_s: 30 },
  ]) {
    const api = apiFalsa({ async chamada() { return dados; } });
    const { ari, servico } = montar({ api });
    ari.iniciar('w', ['entrar', token({ cid: 92, papel: 'origem', uid: 3 })]);
    await servico.ocioso();
    assert.deepEqual(ari.ops, [['hangup', 'w', 'normal']]);
    assert.equal(servico.ativas(), 0);
  }
});

test('morador para chamada que o serviço não conhece é desligado depois de esperar 10 s', async () => {
  const { ari, servico, temporizador } = montar();
  ari.iniciar('app1', ['entrar', token({ cid: 55, papel: 'morador', uid: 42 })]);
  await servico.ocioso();
  assert.deepEqual(ari.ops, []);
  temporizador.disparar(10_000);
  await servico.ocioso();
  assert.deepEqual(ari.ops, [['hangup', 'app1', 'normal']]);
});

test('ponte falha: registra falha e desliga', async () => {
  const { ari, api, servico } = montar();
  ari.falharPonte = true;
  ari.iniciar('fac1', ['facial', 'fac-12', '106']);
  await servico.ocioso();
  ari.iniciar('app1', ['entrar', token({ cid: 77, papel: 'morador', uid: 42 })]);
  await servico.ocioso();
  assert.equal(eventos(api).at(-1).resultado, 'falha');
  assert.equal(servico.ativas(), 0);
});

test('dtmf e encerrar pelo controle', async () => {
  const { ari, api, servico } = montar();
  ari.iniciar('fac1', ['facial', 'fac-12', '106']);
  await servico.ocioso();
  ari.iniciar('app1', ['entrar', token({ cid: 77, papel: 'morador', uid: 42 })]);
  await servico.ocioso();
  assert.equal(await servico.dtmf(77, '#1'), true);
  assert.deepEqual(ari.de('enviarDtmf'), [['enviarDtmf', 'fac1', '#1']]);
  assert.equal(await servico.dtmf(78, '1'), false);
  assert.equal(servico.encerrar(77), true);
  await servico.ocioso();
  assert.deepEqual(eventos(api).at(-1), { evento: 'encerrada', resultado: 'atendida_morador', duracao_s: 0 });
  assert.equal(servico.encerrar(77), false);
});

test('aviso aos 150 s toca o bipe na ponte e fim aos 180 s encerra', async () => {
  const { ari, api, servico, temporizador, relogio } = montar();
  ari.iniciar('fac1', ['facial', 'fac-12', '106']);
  await servico.ocioso();
  ari.iniciar('app1', ['entrar', token({ cid: 77, papel: 'morador', uid: 42 })]);
  await servico.ocioso();
  temporizador.disparar(150_000);
  await servico.ocioso();
  assert.deepEqual(ari.de('tocarNaPonte'), [['tocarNaPonte', 'p1', 'sound:prestare/beep']]);
  relogio.agora += 180_000;
  temporizador.disparar(180_000);
  await servico.ocioso();
  assert.deepEqual(eventos(api).at(-1), { evento: 'encerrada', resultado: 'atendida_morador', duracao_s: 180 });
});
