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
const interfone = require('../src/drivers/dahua-interfone');
const mock = require('../harness/mock-device');

const { estado } = mock;
const SENHA = 'Ab12Cd34Ef56Gh78Ij90Kl12';

let servidor;
let device;

test.before(async () => {
  // Sem gravar o estado do interfone em disco e sem a espera antes de conferir.
  interfone.configurar({ arquivoSip: null, esperaConferenciaMs: 0, margemMs: 50 });
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
/** Cada teste num "aparelho" novo: fábrica + id novo (a memória da conta é por id). */
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
    conta: 'fac12',
    senha: SENHA,
    contatos: [
      { nome: 'Bloco A · Apto 106', numero: '106', bloco: 'A', andar: '1' },
      { nome: 'Bloco A · Apto 201', numero: '201', bloco: 'A', andar: '2' },
    ],
    ...extra,
  };
}

const configurar = (c, cmd) => dahua.configurarInterfone(device, c, cmd);
const gravacoesDeContato = () =>
  estado.dahua.requisicoes.filter((r) => r.startsWith('GET /cgi-bin/recordUpdater.cgi'));
const contatosNossos = (n, base = 1000) =>
  Array.from({ length: n }, (_, i) => ({ nome: `Apto ${base + i}`, numero: String(base + i), bloco: '', andar: '' }));
/** Coloca direto no aparelho falso os contatos como o agente gravaria. */
function preencherAparelho(contatos) {
  for (const c of contatos) {
    estado.dahua.contatos.push({
      RecNo: String(estado.dahua.proximoRecNo++),
      FirstName: c.nome,
      VTShortNumber: c.numero,
      VTOBuilding: c.bloco,
      Notes: 'prestare',
      RegisterType: 'public',
      VTHPassword: 'x',
    });
  }
}

test('aparelho de fábrica: grava a conta SIP e a lista telefônica (VideoTalkContact)', async () => {
  aparelhoNovo();
  const r = await configurar(cfg());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.parcial, false);
  assert.equal(r.sip.alterado, true);
  assert.deepEqual(r.contatos, { inseridos: 2, atualizados: 0, removidos: 0, iguais: 0 });
  assert.deepEqual(r.conflitos, []);

  const sip = estado.dahua.sip;
  assert.equal(sip.SIPServer, 'voz.prestarecondominios.com.br');
  assert.equal(sip.SIPServerPort, '5060');
  assert.equal(sip.UserID, 'fac12');
  assert.equal(sip.AuthID, 'fac12');
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
  await configurar(cfg());
  const gravacoes = estado.dahua.gravacoesSip;
  estado.dahua.requisicoes.length = 0;

  const r = await configurar(cfg());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.sip.alterado, false);
  assert.deepEqual(r.contatos, { inseridos: 0, atualizados: 0, removidos: 0, iguais: 2 });
  assert.equal(estado.dahua.gravacoesSip, gravacoes, 'setConfig não foi chamado');
  assert.deepEqual(gravacoesDeContato(), [], 'recordUpdater não foi chamado');
});

test('senha escondida na leitura: grava uma vez, não regrava a mesma, regrava a nova; forcar regrava sempre', async () => {
  aparelhoNovo();
  estado.dahua.mascararSenhaSip = true;
  assert.equal((await configurar(cfg())).sip.alterado, true);
  assert.equal((await configurar(cfg())).sip.alterado, false, 'mesma senha já aplicada por este agente');
  assert.equal(estado.dahua.gravacoesSip, 1);

  const nova = await configurar(cfg({ senha: 'Zz99Yy88Xx77Ww66Vv55Uu44' }));
  assert.equal(nova.sip.alterado, true);
  assert.equal(estado.dahua.sip.AuthPassword, 'Zz99Yy88Xx77Ww66Vv55Uu44');

  const forcado = await configurar(cfg({ senha: 'Zz99Yy88Xx77Ww66Vv55Uu44', forcar: true }));
  assert.equal(forcado.sip.alterado, true, 'clique manual com forcar manda a senha de novo');
  assert.equal(estado.dahua.gravacoesSip, 3);
});

test('senha lida de volta diferente do que foi gravado (firmware que cifra): sem "não gravou" e sem regravar', async () => {
  aparelhoNovo();
  estado.dahua.senhaLidaCifrada = true;
  const r = await configurar(cfg());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.sip.alterado, true);
  const r2 = await configurar(cfg());
  assert.equal(r2.sip.alterado, false);
  assert.equal(estado.dahua.gravacoesSip, 1);
});

test('senha trocada no aparelho por fora (legível): regrava', async () => {
  aparelhoNovo();
  await configurar(cfg());
  estado.dahua.sip.AuthPassword = 'outra';
  const r = await configurar(cfg());
  assert.equal(r.sip.alterado, true);
  assert.equal(estado.dahua.sip.AuthPassword, SENHA);
});

test('conta SIP de outro servidor (do instalador): não sobrescreve sem forcar', async () => {
  aparelhoNovo();
  Object.assign(estado.dahua.sip, { SIPServer: '10.0.0.5', UserID: '2001', AuthID: '2001', UserEnable: 'true' });
  const r = await configurar(cfg());
  assert.equal(r.ok, false);
  assert.equal(r.error, 'sip_de_outro_servidor');
  assert.equal(r.servidor_atual, '10.0.0.5');
  assert.equal(estado.dahua.gravacoesSip, 0);
  assert.deepEqual(gravacoesDeContato(), [], 'nem a lista é mexida');
  assert.equal(estado.dahua.sip.SIPServer, '10.0.0.5');

  const forcado = await configurar(cfg({ forcar: true }));
  assert.equal(forcado.ok, true, JSON.stringify(forcado));
  assert.equal(estado.dahua.sip.SIPServer, 'voz.prestarecondominios.com.br');
});

test('servidor normalizado: o aparelho com o IP do nosso domínio (ou maiúsculas, "sip:", ":5060") conta como o nosso', async () => {
  aparelhoNovo();
  Object.assign(estado.dahua.sip, { SIPServer: '127.0.0.1', UserID: 'fac12', AuthID: 'fac12', UserEnable: 'true', AuthPassword: SENHA });
  const r = await configurar(cfg({ servidor: 'localhost', contatos: [] }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.sip.alterado, false);

  aparelhoNovo();
  Object.assign(estado.dahua.sip, {
    SIPServer: 'sip:VOZ.PrestareCondominios.com.br:5060',
    UserID: 'fac12',
    AuthID: 'fac12',
    UserEnable: 'true',
    AuthPassword: SENHA,
  });
  const r2 = await configurar(cfg({ contatos: [] }));
  assert.equal(r2.ok, true, JSON.stringify(r2));
  assert.equal(r2.sip.alterado, false);
});

test('firmware sem o campo AuthID: não manda o que não existe e não acusa "não gravou"', async () => {
  aparelhoNovo();
  estado.dahua.sipSemAuthID = true;
  const r = await configurar(cfg());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.avisos, []);
  assert.equal(estado.dahua.gravacoesSip, 1);
  assert.equal(estado.dahua.ultimoSetSip.includes('SIP.AuthID'), false);
  assert.equal((await configurar(cfg())).sip.alterado, false);
});

test('aparelho responde OK mas não guarda a conta: vira aviso (não "não gravou" eterno) e não regrava em loop', async () => {
  aparelhoNovo();
  estado.dahua.sipIgnoraGravacao = true;
  const r = await configurar(cfg());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.avisos.some((a) => /SIPServer/.test(a)), JSON.stringify(r.avisos));
  const gravacoes = estado.dahua.gravacoesSip;
  const r2 = await configurar(cfg());
  assert.equal(r2.sip.alterado, false);
  assert.equal(estado.dahua.gravacoesSip, gravacoes);
  assert.ok(r2.avisos.length > 0, 'a divergência continua avisada');
});

test('firmware sem configManager SIP: falha clara e não toca na lista', async () => {
  aparelhoNovo();
  estado.dahua.semConfigSip = true;
  const r = await configurar(cfg());
  assert.equal(r.ok, false);
  assert.match(r.error, /SIP/);
  assert.deepEqual(
    estado.dahua.requisicoes.filter((x) => /recordFinder|recordUpdater/.test(x)),
    [],
  );
});

test('lista muda: só os nossos (Notes=prestare) mudam; contato manual com o mesmo número fica e vira conflito', async () => {
  aparelhoNovo();
  await configurar(cfg());
  estado.dahua.contatos.push({ RecNo: '90', VTShortNumber: '999', FirstName: 'Zelador', Notes: '', RegisterType: 'public', VTHPassword: 'x' });
  estado.dahua.contatos.push({ RecNo: '91', VTShortNumber: '301', FirstName: 'Monitor 301', Notes: '', RegisterType: 'public', VTHPassword: 'y' });

  const r = await configurar(
    cfg({
      contatos: [
        { nome: 'Bloco A · Apto 106 (Cobertura)', numero: '106', bloco: 'A', andar: '1' },
        { nome: 'Bloco A · Apto 301', numero: '301', bloco: 'A', andar: '3' },
      ],
    }),
  );
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.contatos, { inseridos: 0, atualizados: 1, removidos: 1, iguais: 0 });
  assert.deepEqual(r.conflitos, ['301']);
  const porNumero = Object.fromEntries(estado.dahua.contatos.map((c) => [c.VTShortNumber, c]));
  assert.equal(porNumero['106'].FirstName, 'Bloco A - Apto 106 Cobertura');
  assert.equal(porNumero['106'].RecNo, '1', 'atualizado no lugar');
  assert.equal(porNumero['201'], undefined, 'o nosso que saiu foi removido');
  assert.deepEqual(porNumero['301'], { RecNo: '91', VTShortNumber: '301', FirstName: 'Monitor 301', Notes: '', RegisterType: 'public', VTHPassword: 'y' });
  assert.equal(porNumero['999'].FirstName, 'Zelador');
  assert.equal(estado.dahua.contatos.filter((c) => c.VTShortNumber === '301').length, 1, 'não duplica o número');
});

test('lista vazia não remove nada; só com remover:true', async () => {
  aparelhoNovo();
  await configurar(cfg());
  const r = await configurar(cfg({ contatos: [] }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.contatos.removidos, 0);
  assert.equal(estado.dahua.contatos.length, 2);
  assert.ok(r.avisos.some((a) => /vazia/.test(a)));

  const r2 = await configurar(cfg({ contatos: [], remover: true }));
  assert.equal(r2.contatos.removidos, 2);
  assert.equal(estado.dahua.contatos.length, 0);
});

test('firmware que limita o count: pagina pelo offset e lê a lista inteira', async () => {
  aparelhoNovo();
  const lista = contatosNossos(150);
  preencherAparelho(lista);
  estado.dahua.limiteBuscaContatos = 100;
  const r = await configurar(cfg({ contatos: lista }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.contatos, { inseridos: 0, atualizados: 0, removidos: 0, iguais: 150 });
  assert.deepEqual(gravacoesDeContato(), []);
  assert.ok(estado.dahua.requisicoes.filter((x) => x.includes('recordFinder.cgi?find')).length >= 2, 'mais de uma página');
});

test('firmware que limita o count e ignora o offset: não altera nada (lista pela metade)', async () => {
  aparelhoNovo();
  preencherAparelho(contatosNossos(150));
  estado.dahua.limiteBuscaContatos = 100;
  estado.dahua.ignoraOffset = true;
  const r = await configurar(cfg({ contatos: contatosNossos(3, 5000) }));
  assert.equal(r.ok, false);
  assert.match(r.error, /lista telefônica/i);
  assert.deepEqual(gravacoesDeContato(), []);
  assert.equal(estado.dahua.contatos.length, 150);
});

test('firmware sem getQuerySize e sem totalCount: pagina até a página vir menor', async () => {
  aparelhoNovo();
  const lista = contatosNossos(120);
  preencherAparelho(lista);
  estado.dahua.semQuerySize = true;
  estado.dahua.semTotalCount = true;
  const r = await configurar(cfg({ contatos: lista }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.contatos.iguais, 120);
});

test('RecNo não numérico: não manda recno torto ao aparelho e avisa', async () => {
  aparelhoNovo();
  estado.dahua.contatos.push({ RecNo: 'abc', VTShortNumber: '777', FirstName: 'X', Notes: 'prestare', RegisterType: 'public', VTHPassword: 'x' });
  const r = await configurar(cfg());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.avisos.some((a) => /RecNo/.test(a)));
  assert.equal(estado.dahua.urls.some((x) => /recno=abc/.test(x)), false);
});

test('carga grande: grava em lotes e devolve parcial; repetir continua de onde parou', async () => {
  aparelhoNovo();
  const lista = contatosNossos(45);
  const r = await configurar(cfg({ contatos: lista }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.parcial, true);
  assert.equal(r.contatos.inseridos, 30);
  assert.equal(r.restantes, 15);
  const r2 = await configurar(cfg({ contatos: lista }));
  assert.equal(r2.parcial, false);
  assert.equal(r2.contatos.inseridos, 15);
  assert.equal(r2.contatos.iguais, 30);
  assert.equal(estado.dahua.contatos.length, 45);
});

test('prazo: com o aparelho lento, para antes do fim do prazo e devolve parcial', async () => {
  aparelhoNovo();
  estado.dahua.atrasoMs = 30;
  const inicio = Date.now();
  const fim = inicio + 900;
  const cmd = { _prazoRestanteMs: () => Math.max(0, fim - Date.now()) };
  const r = await configurar(cfg({ contatos: contatosNossos(20) }), cmd);
  const gasto = Date.now() - inicio;
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.parcial, true);
  assert.ok(r.restantes > 0);
  assert.ok(gasto < 900 + 150, `levou ${gasto} ms`);
});

test('dados inválidos (inclusive conta com hífen): recusa sem falar com o aparelho', async () => {
  aparelhoNovo();
  const casos = [
    cfg({ servidor: '' }),
    cfg({ porta: 70000 }),
    cfg({ conta: '' }),
    cfg({ conta: 'fac-12' }),
    cfg({ conta: 'fac.12' }),
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
    const r = await configurar(c);
    assert.equal(r.ok, false, JSON.stringify(c));
  }
  assert.deepEqual(estado.dahua.requisicoes, []);
});

test('a senha nunca aparece no resultado, no erro nem no log (inclusive "URL inválida")', async () => {
  aparelhoNovo();
  const linhas = [];
  const orig = { log: console.log, error: console.error, warn: console.warn };
  console.log = console.error = console.warn = (...a) => linhas.push(a.join(' '));
  const resultados = [];
  try {
    resultados.push(await configurar(cfg()));
    estado.dahua.sipIgnoraGravacao = true;
    resultados.push(await configurar(cfg({ senha: 'Novasenha123456789012345' })));
    // Endereço torto: a URL do setConfig (com a senha) não pode ir para o erro.
    const torto = { ...device, id: device.id + 50000, porta: 'x y' };
    resultados.push(await dahua.configurarInterfone(torto, cfg({ senha: 'Tortasenha123456789012345' })));
    resultados.push(await dahua.executar(torto, { type: 'interfone_config', interfone: cfg({ senha: 'Tortasenha123456789012345' }) }));
  } finally {
    Object.assign(console, orig);
  }
  assert.equal(resultados[0].ok, true);
  assert.equal(resultados[2].ok, false);
  const tudo = JSON.stringify(resultados) + linhas.join('\n');
  for (const s of [SENHA, 'Novasenha123456789012345', 'Tortasenha123456789012345']) {
    assert.ok(!tudo.includes(s), `senha vazou: ${s}`);
    assert.ok(!tudo.includes(encodeURIComponent(s)));
  }
});

test('executar: comando interfone_config chega ao driver; sem dados → recusa', async () => {
  aparelhoNovo();
  const r = await dahua.executar(device, { type: 'interfone_config', interfone: cfg() });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(estado.dahua.contatos.length, 2);
  const sem = await dahua.executar(device, { type: 'interfone_config' });
  assert.equal(sem.ok, false);
});

// ---------- Re-revisão ----------

test('firmware que corta o nome: depois de gravado, a diferença vira aviso (sem "parcial" eterno); nome novo grava de novo', async () => {
  aparelhoNovo();
  estado.dahua.cortaNomeContato = 8;
  const r1 = await configurar(cfg());
  assert.equal(r1.contatos.inseridos, 2);
  for (let i = 0; i < 2; i++) {
    const r = await configurar(cfg());
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.parcial, false);
    assert.equal(r.restantes, 0);
    assert.equal(r.contatos.atualizados, 0, `rodada ${i}`);
    assert.ok(r.avisos.some((a) => /106/.test(a)), JSON.stringify(r.avisos));
  }
  assert.deepEqual(gravacoesDeContato().filter((x) => x.includes('update')), []);
  // Nome desejado mudou de verdade: grava.
  const r4 = await configurar(cfg({ contatos: [{ nome: 'Outro 106', numero: '106', bloco: 'A', andar: '1' }] }));
  assert.equal(r4.contatos.atualizados, 1);
  // Alterado à mão no aparelho depois: grava de novo.
  estado.dahua.cortaNomeContato = null;
  estado.dahua.contatos.find((c) => c.VTShortNumber === '106').FirstName = 'Mexido';
  await configurar(cfg({ contatos: [{ nome: 'Outro 106', numero: '106', bloco: 'A', andar: '1' }] }));
  const r6 = await configurar(cfg({ contatos: [{ nome: 'Outro 106', numero: '106', bloco: 'A', andar: '1' }] }));
  assert.equal(estado.dahua.contatos.find((c) => c.VTShortNumber === '106').FirstName, 'Outro 106');
  assert.equal(r6.contatos.iguais, 1);
});

test('lote: inclusões e remoções andam mesmo com muitas alterações pendentes; restantes = operações que faltam', async () => {
  aparelhoNovo();
  preencherAparelho(contatosNossos(40).map((c) => ({ ...c, nome: `Antigo ${c.numero}` })));
  preencherAparelho([{ nome: 'Sai', numero: '8888', bloco: '' }]);
  const lista = [...contatosNossos(40), ...contatosNossos(5, 7000)];
  const r = await configurar(cfg({ contatos: lista }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.parcial, true);
  assert.equal(r.contatos.inseridos, 5);
  assert.equal(r.contatos.removidos, 1);
  assert.equal(r.contatos.atualizados, 24);
  assert.equal(r.restantes, 16);
});

test('só a leitura da lista já estoura o prazo: ok:false "lista grande demais para o prazo" (não parcial)', async () => {
  aparelhoNovo();
  Object.assign(estado.dahua.sip, { SIPServer: 'voz.prestarecondominios.com.br', UserID: 'fac12', AuthID: 'fac12', UserEnable: 'true', AuthPassword: SENHA });
  preencherAparelho(contatosNossos(1000));
  estado.dahua.atrasoMs = 30;
  const fim = Date.now() + 400;
  const r = await configurar(cfg({ contatos: contatosNossos(1000) }), { _prazoRestanteMs: () => Math.max(0, fim - Date.now()) });
  assert.equal(r.ok, false);
  assert.match(r.error, /lista grande demais para o prazo/);
  assert.equal(r.parcial, undefined);
  assert.deepEqual(gravacoesDeContato(), []);
});

test('sem total conhecido e firmware que corta o count abaixo da página: pagina até vir página vazia', async () => {
  aparelhoNovo();
  const lista = contatosNossos(120);
  preencherAparelho(lista);
  estado.dahua.semQuerySize = true;
  estado.dahua.semTotalCount = true;
  estado.dahua.limiteBuscaContatos = 50;
  const r = await configurar(cfg({ contatos: lista }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.contatos.iguais, 120);
  assert.deepEqual(gravacoesDeContato(), []);
});

test('corpo de resposta com senha (Password=, pwd=, secret=) sai mascarado no erro', async () => {
  aparelhoNovo();
  estado.dahua.respostaSipCrua = 'table.SIP[0].Password=xyz123&pwd=abc777 secret_key=zzz999';
  const r = await configurar(cfg());
  assert.equal(r.ok, false);
  for (const s of ['xyz123', 'abc777', 'zzz999']) assert.ok(!r.error.includes(s), r.error);
});

test('porta esperando na fila: o interfone cede entre as gravações e devolve parcial', async () => {
  aparelhoNovo();
  let chamadas = 0;
  const cmd = { _haUrgenteNaFila: () => ++chamadas > 3 };
  const r = await configurar(cfg({ contatos: contatosNossos(10) }), cmd);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.parcial, true);
  assert.ok(r.contatos.inseridos < 10);
  assert.ok(r.avisos.some((a) => /porta/.test(a)));

  aparelhoNovo();
  const logo = await configurar(cfg(), { _haUrgenteNaFila: () => true });
  assert.equal(logo.ok, true, JSON.stringify(logo));
  assert.equal(logo.parcial, true);
  assert.ok(logo.avisos.some((a) => /porta/.test(a)));
  assert.equal(estado.dahua.gravacoesSip, 0, 'não começa a gravar com porta esperando');
});

test('porta esperando: cede antes do setConfig SIP, entre as páginas da lista e entre a gravação e a leitura de volta', async () => {
  // 1) chega depois da leitura da conta, antes do setConfig
  aparelhoNovo();
  let n = 0;
  let r = await configurar(cfg(), { _haUrgenteNaFila: () => ++n > 1 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.parcial, true);
  assert.equal(estado.dahua.gravacoesSip, 0, 'setConfig não saiu');

  // 2) entre as páginas da lista (conta já certa, 250 contatos = 3 páginas)
  aparelhoNovo();
  Object.assign(estado.dahua.sip, { SIPServer: 'voz.prestarecondominios.com.br', UserID: 'fac12', AuthID: 'fac12', UserEnable: 'true', AuthPassword: SENHA });
  preencherAparelho(contatosNossos(250));
  let paginas = 0;
  r = await configurar(cfg({ contatos: contatosNossos(250) }), {
    _haUrgenteNaFila: () => {
      paginas = estado.dahua.requisicoes.filter((x) => x.includes('recordFinder.cgi?find')).length;
      return paginas >= 1;
    },
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.parcial, true);
  // Uma página = 2 requisições HTTP (o desafio Digest 401 + a autenticada).
  assert.equal(estado.dahua.requisicoes.filter((x) => x.includes('recordFinder.cgi?find')).length, 2, 'parou depois da 1ª página');
  assert.deepEqual(gravacoesDeContato(), []);

  // 3) entre a gravação e a leitura de volta: não lê de volta, devolve parcial, e não regrava depois
  aparelhoNovo();
  let gravou = false;
  r = await configurar(cfg({ contatos: contatosNossos(1) }), {
    _haUrgenteNaFila: () => {
      if (gravou) return true;
      gravou = gravacoesDeContato().length > 0;
      return gravou;
    },
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.parcial, true);
  assert.equal(r.contatos.inseridos, 1);
  estado.dahua.requisicoes.length = 0;
  const r2 = await configurar(cfg({ contatos: contatosNossos(1) }));
  assert.equal(r2.parcial, false);
  assert.deepEqual(gravacoesDeContato(), []);
});

test('firmware que ignora o filtro na leitura de volta (contato não aparece): marca não confirmado, avisa e não regrava para sempre', async () => {
  aparelhoNovo();
  estado.dahua.cortaNomeContato = 6;
  estado.dahua.ignoraFiltroContato = true;
  preencherAparelho(contatosNossos(15, 3000)); // os 10 primeiros da busca "sem filtro" são estes
  const lista = [...contatosNossos(15, 3000), { nome: 'Bloco Z Apto 9999', numero: '9999', bloco: '', andar: '' }];
  const r1 = await configurar(cfg({ contatos: lista }));
  assert.equal(r1.ok, true, JSON.stringify(r1));
  assert.equal(r1.contatos.inseridos, 1);
  assert.ok(r1.avisos.some((a) => /não deu para conferir o contato 9999/.test(a)), JSON.stringify(r1.avisos));
  for (let i = 0; i < 2; i++) {
    estado.dahua.requisicoes.length = 0;
    const r = await configurar(cfg({ contatos: lista }));
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.parcial, false, `rodada ${i}`);
    assert.deepEqual(gravacoesDeContato(), [], `rodada ${i}: não regrava o 9999`);
  }
  // E se alguém mexer no contato à mão depois de confirmado, grava de novo.
  estado.dahua.cortaNomeContato = null;
  estado.dahua.contatos.find((c) => c.VTShortNumber === '9999').FirstName = 'Mexido';
  const r4 = await configurar(cfg({ contatos: lista }));
  assert.equal(r4.contatos.atualizados, 1);
});

test('servidor vazio, 0.0.0.0 ou conta desativada não contam como "outro servidor"', async () => {
  for (const sip of [{ SIPServer: '0.0.0.0', UserEnable: 'true' }, { SIPServer: '192.168.1.10', UserEnable: 'false' }, { SIPServer: '' }]) {
    aparelhoNovo();
    Object.assign(estado.dahua.sip, sip);
    const r = await configurar(cfg());
    assert.equal(r.ok, true, `${JSON.stringify(sip)} → ${JSON.stringify(r)}`);
    assert.equal(estado.dahua.sip.SIPServer, 'voz.prestarecondominios.com.br');
  }
});
