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
