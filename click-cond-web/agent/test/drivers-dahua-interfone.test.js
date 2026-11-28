'use strict';

/**
 * Interfone no Intelbras/Dahua (`interfone_config`): conta SIP por
 * configManager `SIP` e lista telefônica por `VideoTalkContact`, contra o
 * aparelho FALSO do harness (agent/harness/mock-device.js, com Digest de
 * verdade, em 127.0.0.1). Os nomes seguem a doc HTTP API da Dahua V3.26 —
 * confirmar no SS 3532 real (roteiro de bancada do G1).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const dahua = require('../src/drivers/dahua-facial');
const mock = require('../harness/mock-device');

const { estado } = mock;
const SENHA = 'Ab12Cd34Ef56Gh78Ij90Kl12';

let servidor;
let device;

test.before(async () => {
  // Sem gravar o estado do interfone em disco durante os testes.
  dahua.configurar({ arquivoInterfoneSip: null });
  servidor = mock.servidorDahua(0, () => {});
  await once(servidor, 'listening');
  device = {
    id: 7001,
    nome: 'Facial falso',
    fabricante: 'intelbras',
    ip: '127.0.0.1',
    porta: servidor.address().port,
    api_user: mock.USER,
    api_password: mock.PASS,
  };
});

test.after(async () => {
  await servidor.fecharAgora();
});

let proximoId = 7100;
/** Cada teste num "aparelho" novo: fábrica + id novo (a memória da senha é por id). */
function aparelhoNovo() {
  mock.reiniciarInterfoneDahua();
  estado.dahua.requisicoes.length = 0;
  device = { ...device, id: proximoId++ };
  return device;
}

function cfg(extra = {}) {
  return {
    servidor: 'voz.prestarecondominios.com.br',
    porta: 5060,
    conta: 'fac-12',
    senha: SENHA,
    contatos: [
      { nome: 'Bloco A · Apto 106', numero: '106', bloco: 'A', andar: '1' },
      { nome: 'Bloco A · Apto 201', numero: '201', bloco: 'A', andar: '2' },
    ],
    ...extra,
  };
}

const gravacoesDeContato = () =>
  estado.dahua.requisicoes.filter((r) => r.startsWith('GET /cgi-bin/recordUpdater.cgi'));

test('aparelho de fábrica: grava a conta SIP e a lista telefônica (VideoTalkContact)', async () => {
  aparelhoNovo();
  const r = await dahua.configurarInterfone(device, cfg());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.sip.alterado, true);
  assert.deepEqual(r.contatos, { inseridos: 2, atualizados: 0, removidos: 0, iguais: 0 });

  const sip = estado.dahua.sip;
  assert.equal(sip.SIPServer, 'voz.prestarecondominios.com.br');
  assert.equal(sip.SIPServerPort, '5060');
  assert.equal(sip.UserID, 'fac-12');
  assert.equal(sip.AuthID, 'fac-12');
  assert.equal(sip.AuthPassword, SENHA);
  assert.equal(sip.UserEnable, 'true');

  const [c1, c2] = estado.dahua.contatos;
  assert.equal(c1.VTShortNumber, '106');
  // "·" sai: o firmware só garante letras, números, espaço, "-" e "_" no nome.
  assert.equal(c1.FirstName, 'Bloco A - Apto 106');
  assert.equal(c1.VTOBuilding, 'A');
  assert.equal(c1.Notes, 'prestare');
  assert.equal(c1.RegisterType, 'public');
  assert.ok(c1.VTHPassword && c1.VTHPassword !== SENHA, 'senha do contato existe e não é a da conta SIP');
  assert.equal(c2.VTShortNumber, '201');
});

test('segunda vez com os mesmos dados: lê e não grava nada', async () => {
  aparelhoNovo();
  await dahua.configurarInterfone(device, cfg());
  const gravacoes = estado.dahua.gravacoesSip;
  estado.dahua.requisicoes.length = 0;

  const r = await dahua.configurarInterfone(device, cfg());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.sip.alterado, false);
  assert.deepEqual(r.contatos, { inseridos: 0, atualizados: 0, removidos: 0, iguais: 2 });
  assert.equal(estado.dahua.gravacoesSip, gravacoes, 'setConfig não foi chamado');
  assert.deepEqual(gravacoesDeContato(), [], 'recordUpdater não foi chamado');
});

test('firmware que esconde a senha na leitura: grava uma vez, não regrava a mesma senha, regrava senha nova', async () => {
  aparelhoNovo();
  estado.dahua.mascararSenhaSip = true;
  assert.equal((await dahua.configurarInterfone(device, cfg())).sip.alterado, true);
  assert.equal(estado.dahua.gravacoesSip, 1);

  const igual = await dahua.configurarInterfone(device, cfg());
  assert.equal(igual.sip.alterado, false, 'mesma senha já aplicada por este agente');
  assert.equal(estado.dahua.gravacoesSip, 1);

  const nova = await dahua.configurarInterfone(device, cfg({ senha: 'Zz99Yy88Xx77Ww66Vv55Uu44' }));
  assert.equal(nova.sip.alterado, true);
  assert.equal(estado.dahua.sip.AuthPassword, 'Zz99Yy88Xx77Ww66Vv55Uu44');
});

test('senha trocada no aparelho por fora (legível): regrava', async () => {
  aparelhoNovo();
  await dahua.configurarInterfone(device, cfg());
  estado.dahua.sip.AuthPassword = 'outra';
  const r = await dahua.configurarInterfone(device, cfg());
  assert.equal(r.sip.alterado, true);
  assert.equal(estado.dahua.sip.AuthPassword, SENHA);
});

test('lista muda: atualiza o nome, remove o ramal que saiu (só os nossos) e não mexe no contato do instalador', async () => {
  aparelhoNovo();
  await dahua.configurarInterfone(device, cfg());
  // Contato criado à mão pelo instalador (sem a nossa marca).
  estado.dahua.contatos.push({ RecNo: '90', VTShortNumber: '999', FirstName: 'Zelador', Notes: '', RegisterType: 'public', VTHPassword: 'x' });
  // Contato manual com o mesmo número de uma unidade nossa: passa a ser nosso.
  estado.dahua.contatos.push({ RecNo: '91', VTShortNumber: '301', FirstName: 'Antigo', Notes: '', RegisterType: 'public', VTHPassword: 'x' });

  const r = await dahua.configurarInterfone(
    device,
    cfg({
      contatos: [
        { nome: 'Bloco A · Apto 106 (Cobertura)', numero: '106', bloco: 'A', andar: '1' },
        { nome: 'Bloco A · Apto 301', numero: '301', bloco: 'A', andar: '3' },
      ],
    }),
  );
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.contatos, { inseridos: 0, atualizados: 2, removidos: 1, iguais: 0 });
  const porNumero = Object.fromEntries(estado.dahua.contatos.map((c) => [c.VTShortNumber, c]));
  assert.equal(porNumero['106'].FirstName, 'Bloco A - Apto 106 Cobertura');
  assert.equal(porNumero['106'].RecNo, '1', 'atualizado no lugar, não removido e inserido');
  assert.equal(porNumero['201'], undefined, 'ramal que saiu foi removido');
  assert.equal(porNumero['301'].FirstName, 'Bloco A - Apto 301');
  assert.equal(porNumero['301'].Notes, 'prestare');
  assert.equal(porNumero['999'].FirstName, 'Zelador', 'contato do instalador intacto');
});

test('firmware sem configManager SIP: falha clara e não toca na lista', async () => {
  aparelhoNovo();
  estado.dahua.semConfigSip = true;
  const r = await dahua.configurarInterfone(device, cfg());
  assert.equal(r.ok, false);
  assert.match(r.error, /SIP/);
  assert.deepEqual(
    estado.dahua.requisicoes.filter((x) => /recordFinder|recordUpdater/.test(x)),
    [],
  );
});

test('aparelho responde OK mas não grava a conta: confere lendo de volta e falha', async () => {
  aparelhoNovo();
  estado.dahua.sipIgnoraGravacao = true;
  const r = await dahua.configurarInterfone(device, cfg());
  assert.equal(r.ok, false);
  assert.match(r.error, /não gravou/);
});

test('lista lida pela metade (aparelho cortou a busca): não grava nem remove nenhum contato', async () => {
  aparelhoNovo();
  await dahua.configurarInterfone(device, cfg());
  estado.dahua.limiteBuscaContatos = 1;
  estado.dahua.requisicoes.length = 0;
  const r = await dahua.configurarInterfone(device, cfg({ contatos: [{ nome: 'X', numero: '500', bloco: '', andar: '' }] }));
  assert.equal(r.ok, false);
  assert.match(r.error, /lista telefônica/i);
  assert.deepEqual(gravacoesDeContato(), []);
  assert.equal(estado.dahua.contatos.length, 2);
});

test('dados inválidos: recusa sem falar com o aparelho', async () => {
  aparelhoNovo();
  const casos = [
    cfg({ servidor: '' }),
    cfg({ porta: 70000 }),
    cfg({ conta: '' }),
    cfg({ senha: 'abc;def' }),
    cfg({ contatos: [{ nome: 'A', numero: '10a', bloco: '', andar: '' }] }),
    cfg({ contatos: 'nada' }),
    cfg({
      contatos: [
        { nome: 'A', numero: '10', bloco: '', andar: '' },
        { nome: 'B', numero: '10', bloco: '', andar: '' },
      ],
    }),
  ];
  for (const c of casos) {
    const r = await dahua.configurarInterfone(device, c);
    assert.equal(r.ok, false, JSON.stringify(c));
  }
  assert.deepEqual(estado.dahua.requisicoes, []);
});

test('a senha nunca aparece no resultado nem no log', async () => {
  aparelhoNovo();
  const linhas = [];
  const orig = { log: console.log, error: console.error, warn: console.warn };
  console.log = console.error = console.warn = (...a) => linhas.push(a.join(' '));
  let r;
  try {
    r = await dahua.configurarInterfone(device, cfg());
    estado.dahua.sipIgnoraGravacao = true;
    await dahua.configurarInterfone(device, cfg({ senha: 'Novasenha123456789012345' }));
  } finally {
    Object.assign(console, orig);
  }
  assert.equal(r.ok, true);
  const tudo = JSON.stringify(r) + linhas.join('\n');
  assert.ok(!tudo.includes(SENHA), 'senha vazou');
  assert.ok(!tudo.includes('Novasenha123456789012345'), 'senha nova vazou');
});

test('executar: comando interfone_config chega ao driver; sem dados → recusa', async () => {
  aparelhoNovo();
  const r = await dahua.executar(device, { type: 'interfone_config', interfone: cfg() });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(estado.dahua.contatos.length, 2);
  const sem = await dahua.executar(device, { type: 'interfone_config' });
  assert.equal(sem.ok, false);
});
