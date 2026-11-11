'use strict';

/**
 * agent/src/core/fila-offline.js — enfileira eventos que não subiram, conta
 * pendentes e reenvia (flush) quando a nuvem volta a responder.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { configurar: configurarNuvem } = require('../src/core/nuvem');
const {
  offlineQueuePath,
  enqueueOfflineEvent,
  flushOfflineEvents,
  pendentes,
} = require('../src/core/fila-offline');

function limparFila() {
  try {
    fs.unlinkSync(offlineQueuePath());
  } catch { /* já não existe */ }
}

function comServidor(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        fechar: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

test.beforeEach(() => limparFila());
test.after(() => limparFila());

test('enqueueOfflineEvent()+pendentes(): cada chamada soma uma linha à fila, em ordem', () => {
  assert.equal(pendentes(), 0);
  enqueueOfflineEvent({ a: 1 }, 'device-1');
  enqueueOfflineEvent({ a: 2 }, 'device-1');
  assert.equal(pendentes(), 2);

  const linhas = fs
    .readFileSync(offlineQueuePath(), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  assert.deepEqual(linhas, [{ a: 1 }, { a: 2 }]);
});

test('pendentes(): 0 quando o arquivo da fila ainda não existe', () => {
  assert.equal(pendentes(), 0);
});

test('flushOfflineEvents(): com nuvem falsa (servidor local), envia em ordem e esvazia a fila', async () => {
  const recebidos = [];
  const { url, fechar } = await comServidor((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      recebidos.push(JSON.parse(raw));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  try {
    configurarNuvem({ apiUrl: url });
    enqueueOfflineEvent({ ordem: 1 }, 'device-1');
    enqueueOfflineEvent({ ordem: 2 }, 'device-1');
    enqueueOfflineEvent({ ordem: 3 }, 'device-1');
    assert.equal(pendentes(), 3);

    await flushOfflineEvents('tok');

    assert.deepEqual(recebidos.map((b) => b.ordem), [1, 2, 3]);
    assert.ok(
      recebidos.every((b) => b.backlog === true),
      'todo evento reenviado deve ir marcado backlog: true',
    );
    assert.equal(pendentes(), 0);
  } finally {
    await fechar();
  }
});

test('flushOfflineEvents(): com a nuvem fora do ar, mantém tudo na fila', async () => {
  // Sobe e fecha na hora: a URL aponta para uma porta local sem ninguém
  // escutando — cloudRequest() vai rejeitar por ECONNREFUSED.
  const { url, fechar } = await comServidor((req, res) => res.end());
  await fechar();
  configurarNuvem({ apiUrl: url });

  enqueueOfflineEvent({ ordem: 1 }, 'device-1');
  enqueueOfflineEvent({ ordem: 2 }, 'device-1');
  assert.equal(pendentes(), 2);

  await flushOfflineEvents('tok');

  assert.equal(pendentes(), 2);
  const linhas = fs
    .readFileSync(offlineQueuePath(), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  assert.deepEqual(linhas, [{ ordem: 1 }, { ordem: 2 }]);
});

test('flushOfflineEvents(): evento enfileirado DURANTE o flush não se perde (M4 da revisão final)', async () => {
  // O flush lia a fila, reenviava (com await) e regravava o arquivo só com o
  // que sobrou da leitura inicial — um evento que o stream enfileirasse no
  // meio do reenvio (internet oscilando) era apagado da fila.
  const recebidos = [];
  let enfileirouNoMeio = false;
  const { url, fechar } = await comServidor((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      recebidos.push(JSON.parse(raw));
      if (!enfileirouNoMeio) {
        enfileirouNoMeio = true;
        enqueueOfflineEvent({ ordem: 'novo-no-meio' }, 'device-1');
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  try {
    configurarNuvem({ apiUrl: url });
    enqueueOfflineEvent({ ordem: 1 }, 'device-1');
    enqueueOfflineEvent({ ordem: 2 }, 'device-1');

    await flushOfflineEvents('tok');

    assert.deepEqual(recebidos.map((b) => b.ordem), [1, 2]);
    const linhas = fs
      .readFileSync(offlineQueuePath(), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    assert.deepEqual(linhas, [{ ordem: 'novo-no-meio' }], 'o evento novo continua na fila para o próximo flush');
  } finally {
    await fechar();
  }
});

test('flushOfflineEvents(): falha no meio preserva o não enviado E o que chegou durante o flush, em ordem', async () => {
  let chamadas = 0;
  const { url, fechar } = await comServidor((req, res) => {
    req.resume();
    req.on('end', () => {
      chamadas++;
      if (chamadas === 1) {
        enqueueOfflineEvent({ ordem: 'novo' }, 'device-1');
        res.writeHead(200);
        res.end('{}');
        return;
      }
      res.writeHead(503); // nuvem caiu de novo no 2º envio
      res.end('{}');
    });
  });
  try {
    configurarNuvem({ apiUrl: url });
    enqueueOfflineEvent({ ordem: 1 }, 'device-1');
    enqueueOfflineEvent({ ordem: 2 }, 'device-1');

    await flushOfflineEvents('tok');

    const linhas = fs
      .readFileSync(offlineQueuePath(), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    assert.deepEqual(linhas, [{ ordem: 2 }, { ordem: 'novo' }]);
  } finally {
    await fechar();
  }
});

// ---------- I6: critério ÚNICO de "vale reenviar" (enfileirar x flush) ----------

test('respostaTransitoria(): 5xx, 401, 404, 408 e 429 são transitórios; 2xx e os demais 4xx não', () => {
  const { respostaTransitoria } = require('../src/core/fila-offline');
  for (const s of [500, 502, 503, 504, 599, 401, 404, 408, 429]) assert.equal(respostaTransitoria(s), true, String(s));
  for (const s of [200, 201, 204, 400, 403, 409, 413, 422]) assert.equal(respostaTransitoria(s), false, String(s));
});

for (const status of [401, 404, 408, 429]) {
  test(`flushOfflineEvents(): HTTP ${status} no reenvio é transitório — para o flush e MANTÉM o evento na fila`, async () => {
    // Foi justamente por um 401/404/408/429 que o evento entrou na fila
    // (forwardAccessEvent). Antes o flush tratava qualquer 4xx como "enviado":
    // o evento guardado sumia na primeira tentativa de reenvio.
    let chamadas = 0;
    const { url, fechar } = await comServidor((req, res) => {
      req.resume();
      req.on('end', () => {
        chamadas++;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end('{}');
      });
    });
    try {
      configurarNuvem({ apiUrl: url });
      enqueueOfflineEvent({ ordem: 1 }, 'device-1');
      enqueueOfflineEvent({ ordem: 2 }, 'device-1');

      await flushOfflineEvents('tok');

      assert.equal(chamadas, 1, 'parou no primeiro transitório (não martela o resto da fila)');
      const linhas = fs
        .readFileSync(offlineQueuePath(), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l));
      assert.deepEqual(linhas, [{ ordem: 1 }, { ordem: 2 }]);
    } finally {
      await fechar();
    }
  });
}

test('flushOfflineEvents(): 4xx definitivo (400/403/422) descarta só aquele evento e segue com os demais', async () => {
  const recebidos = [];
  const { url, fechar } = await comServidor((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const corpo = JSON.parse(raw);
      recebidos.push(corpo.ordem);
      const status = { 1: 400, 2: 403, 3: 422 }[corpo.ordem] || 200;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  try {
    configurarNuvem({ apiUrl: url });
    for (const ordem of [1, 2, 3, 4]) enqueueOfflineEvent({ ordem }, 'device-1');
    await flushOfflineEvents('tok');
    assert.deepEqual(recebidos, [1, 2, 3, 4]);
    assert.equal(pendentes(), 0);
  } finally {
    await fechar();
  }
});

test('flushOfflineEvents(): disco cheio ao regravar a fila NÃO rejeita (index.js chama com void), loga uma vez e não reenvia o que já subiu', async () => {
  const recebidos = [];
  const { url, fechar } = await comServidor((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      recebidos.push(JSON.parse(raw).ordem);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  const writeOriginal = fs.writeFileSync;
  const errorOriginal = console.error;
  const erros = [];
  // Disco cheio só para REGRAVAR o arquivo. O append continua funcionando: no
  // Node, appendFileSync chama fs.writeFileSync com flag 'a' por baixo, então
  // o falso deixa esse caso passar (senão o teste não conseguiria enfileirar).
  const discoCheio = (arquivo, dados, opcoes) => {
    if (opcoes && opcoes.flag === 'a') return writeOriginal(arquivo, dados, opcoes);
    throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });
  };
  try {
    configurarNuvem({ apiUrl: url });
    enqueueOfflineEvent({ ordem: 1 }, 'device-1');
    enqueueOfflineEvent({ ordem: 2 }, 'device-1');

    console.error = (...a) => erros.push(a.join(' '));
    fs.writeFileSync = discoCheio;

    // 1) Reenvia tudo, mas não consegue regravar o arquivo: não pode rejeitar.
    await flushOfflineEvents('tok');
    assert.deepEqual(recebidos, [1, 2]);
    const avisos = () => erros.filter((m) => /fila offline/.test(m));
    assert.equal(avisos().length, 1);
    assert.match(avisos()[0], /ENOSPC/);

    // 2) Disco continua cheio: o que já subiu fica marcado em memória e NÃO é reenviado.
    await flushOfflineEvents('tok');
    assert.deepEqual(recebidos, [1, 2]);
    assert.equal(avisos().length, 1, 'loga uma vez, não a cada poll');

    // 3) Evento novo entra (append ainda funciona): só ele sobe.
    enqueueOfflineEvent({ ordem: 3 }, 'device-1');
    await flushOfflineEvents('tok');
    assert.deepEqual(recebidos, [1, 2, 3]);
    assert.equal(avisos().length, 1);

    // 4) Disco voltou: a fila é regravada (vazia) e nada é reenviado.
    fs.writeFileSync = writeOriginal;
    await flushOfflineEvents('tok');
    assert.deepEqual(recebidos, [1, 2, 3]);
    assert.equal(pendentes(), 0);

    // 5) Nova falha depois de recuperar volta a avisar (uma vez).
    enqueueOfflineEvent({ ordem: 4 }, 'device-1');
    fs.writeFileSync = discoCheio;
    await flushOfflineEvents('tok');
    assert.deepEqual(recebidos, [1, 2, 3, 4]);
    assert.equal(avisos().length, 2);
  } finally {
    fs.writeFileSync = writeOriginal;
    console.error = errorOriginal;
    // Zera o estado em memória do módulo para não vazar para outros testes.
    await flushOfflineEvents('tok');
    await fechar();
  }
});
