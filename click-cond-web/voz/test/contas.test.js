import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderizarPjsip, criarSincronizador } from '../src/contas.js';
import { lerConfig } from '../src/config.js';
import { criarApi } from '../src/api.js';

const CONTAS = {
  faciais: [
    { conta: 'fac-12', senha: 'Abc123def456ghi789jkl012', id_condominio: 1, dtmf_modo: 'info' },
    { conta: 'fac-3', senha: 'Zyx987wvu654tsr321qpo000', id_condominio: 2, dtmf_modo: 'rfc4733' },
  ],
  monitores: [{ conta: 'mon-5', senha: 'Mon5senhaLongaAleatoria1', id_condominio: 1, id_apartamento: 9 }],
};

test('renderizarPjsip gera endpoint, auth e aor de cada conta', () => {
  const txt = renderizarPjsip(CONTAS);
  assert.match(txt, /\[fac-12\]\ntype=endpoint\ncontext=prestare-facial\n/);
  assert.match(txt, /\[fac-12\]\ntype=endpoint[^[]*dtmf_mode=info\n/);
  assert.match(txt, /\[fac-3\]\ntype=endpoint[^[]*dtmf_mode=rfc4733\n/);
  assert.match(txt, /\[fac-12\]\ntype=auth\nauth_type=userpass\nusername=fac-12\npassword=Abc123def456ghi789jkl012\n/);
  assert.match(txt, /\[fac-12\]\ntype=aor\nmax_contacts=1\nremove_existing=yes\nqualify_frequency=30\n/);
  assert.match(txt, /\[mon-5\]\ntype=endpoint\ncontext=prestare-monitor\n/);
  for (const linha of ['disallow=all', 'allow=ulaw,alaw,h264', 'direct_media=no', 'rtp_symmetric=yes',
    'force_rport=yes', 'rewrite_contact=yes', 'auth=fac-12', 'aors=fac-12']) {
    assert.ok(txt.includes(linha + '\n'), linha);
  }
});

test('renderizarPjsip tem ordem estável', () => {
  const invertido = { faciais: [...CONTAS.faciais].reverse(), monitores: CONTAS.monitores };
  assert.equal(renderizarPjsip(invertido), renderizarPjsip(CONTAS));
  // fac-3 antes de fac-12 (ordem numérica), faciais antes dos monitores
  const txt = renderizarPjsip(CONTAS);
  assert.ok(txt.indexOf('[fac-3]') < txt.indexOf('[fac-12]'));
  assert.ok(txt.indexOf('[fac-12]') < txt.indexOf('[mon-5]'));
});

test('renderizarPjsip descarta conta ou senha que poderia injetar configuração', () => {
  const txt = renderizarPjsip({
    faciais: [
      { conta: 'fac-1', senha: 'curta', dtmf_modo: 'info' },
      { conta: 'fac-2', senha: 'senhaboa123456\n[x]\ntype=endpoint', dtmf_modo: 'info' },
      { conta: 'fac-x;', senha: 'senhaboa1234567890', dtmf_modo: 'info' },
      { conta: 'fac-4', senha: 'senhaboa1234567890', dtmf_modo: 'qualquer' },
    ],
    monitores: [],
  });
  assert.ok(!txt.includes('[fac-1]'));
  assert.ok(!txt.includes('[fac-2]'));
  assert.ok(!txt.includes('[x]'));
  assert.ok(!txt.includes('fac-x'));
  assert.match(txt, /\[fac-4\]\ntype=endpoint[^[]*dtmf_mode=rfc4733\n/);
});

test('renderizarPjsip recusa resposta malformada', () => {
  assert.throws(() => renderizarPjsip({ faciais: null }));
});

function falsos(contas) {
  const s = { arquivo: '', escritas: 0, recargas: 0, contas, falharRecarga: false };
  s.sync = criarSincronizador({
    api: { contas: async () => s.contas },
    ler: async () => s.arquivo,
    escrever: async (t) => { s.arquivo = t; s.escritas++; },
    recarregar: async () => { if (s.falharRecarga) throw new Error('ari fora'); s.recargas++; },
    log: { info() {}, warn() {}, error() {} },
  });
  return s;
}

test('sincronizar escreve e recarrega só quando mudou', async () => {
  const s = falsos(CONTAS);
  await s.sync.executar();
  assert.equal(s.escritas, 1);
  assert.equal(s.recargas, 1);
  await s.sync.executar();
  assert.equal(s.escritas, 1, 'não reescreve igual');
  assert.equal(s.recargas, 1, 'não recarrega igual');
  s.contas = { faciais: CONTAS.faciais.slice(0, 1), monitores: [] };
  await s.sync.executar();
  assert.equal(s.escritas, 2);
  assert.equal(s.recargas, 2);
});

test('sincronizar recarrega na primeira vez mesmo com arquivo igual e tenta de novo se a recarga falhou', async () => {
  const s = falsos(CONTAS);
  s.arquivo = renderizarPjsip(CONTAS);
  s.falharRecarga = true;
  await s.sync.executar();
  assert.equal(s.escritas, 0);
  assert.equal(s.recargas, 0);
  s.falharRecarga = false;
  await s.sync.executar();
  assert.equal(s.recargas, 1);
  await s.sync.executar();
  assert.equal(s.recargas, 1);
});

test('sincronizar não mexe no arquivo quando a API falha', async () => {
  const s = falsos(CONTAS);
  s.arquivo = 'antigo';
  s.sync = criarSincronizador({
    api: { contas: async () => { throw new Error('fora'); } },
    ler: async () => s.arquivo,
    escrever: async (t) => { s.arquivo = t; s.escritas++; },
    recarregar: async () => { s.recargas++; },
    log: { info() {}, warn() {}, error() {} },
  });
  await s.sync.executar();
  assert.equal(s.arquivo, 'antigo');
  assert.equal(s.recargas, 0);
});

test('lerConfig exige os segredos e aplica padrões', () => {
  assert.throws(() => lerConfig({}), /VOZ_INTERNAL_TOKEN/);
  const c = lerConfig({ VOZ_INTERNAL_TOKEN: 'a', VOZ_TOKEN_SECRET: 'b', VOZ_ARI_SENHA: 'c' });
  assert.equal(c.apiBase, 'https://api.prestarecondominios.com.br/api');
  assert.equal(c.vozToken, 'a');
  assert.equal(c.tokenSecret, 'b');
  assert.equal(c.ariPass, 'c');
  assert.equal(c.ariUser, 'prestare');
  assert.equal(c.ariUrl, 'http://127.0.0.1:8088');
  assert.equal(c.pjsipArquivo, '/etc/asterisk/pjsip_prestare.conf');
  assert.equal(c.controlePorta, 443);
  assert.equal(c.certDir, '/etc/prestare-voz/tls');
});

test('criarApi chama as rotas internas com x-voz-token', async () => {
  const pedidos = [];
  const fetch = async (url, op) => {
    pedidos.push({ url, op });
    return { ok: true, status: 200, json: async () => ({ ok: true, id: 7 }) };
  };
  const api = criarApi({ apiBase: 'https://x/api/', vozToken: 'tk', fetch });
  await api.contas();
  await api.novaChamada('fac-1', '106');
  await api.chamada(7);
  await api.evento(7, { evento: 'toque_esgotado' });
  await api.registros([{ conta: 'fac-1', registrado: true }]);
  assert.deepEqual(pedidos.map((p) => `${p.op.method} ${p.url}`), [
    'GET https://x/api/interno/interfone/contas',
    'POST https://x/api/interno/interfone/chamadas',
    'GET https://x/api/interno/interfone/chamadas/7',
    'POST https://x/api/interno/interfone/chamadas/7/evento',
    'POST https://x/api/interno/interfone/registros',
  ]);
  assert.equal(pedidos[0].op.headers['x-voz-token'], 'tk');
  assert.deepEqual(JSON.parse(pedidos[1].op.body), { conta: 'fac-1', numero: '106' });
  assert.deepEqual(JSON.parse(pedidos[4].op.body), { contas: [{ conta: 'fac-1', registrado: true }] });
});

test('criarApi lança em resposta de erro', async () => {
  const api = criarApi({ apiBase: 'https://x/api', vozToken: 'tk',
    fetch: async () => ({ ok: false, status: 503, json: async () => ({}) }) });
  await assert.rejects(api.contas(), (e) => /503/.test(e.message) && e.status === 503);
});
