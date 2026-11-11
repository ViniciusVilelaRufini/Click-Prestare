'use strict';

/**
 * agent/src/drivers/controlid-facial.js — só o DEFENSIVO, contra um aparelho
 * FALSO (servidor HTTP local em 127.0.0.1): o driver confere o status HTTP
 * de create_objects / modify_objects / user_set_image e recusa faceId não
 * numérico sem falar com o aparelho. O protocolo em si (campos, upsert por
 * registration, validade) não é exercitado aqui — fica para a bancada.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const controlid = require('../src/drivers/controlid-facial');

/** Aparelho falso: `respostas` mapeia o caminho (.fcgi) para { status, json }. */
function aparelho(respostas = {}) {
  return new Promise((resolve) => {
    const chamadas = [];
    const server = http.createServer((req, res) => {
      const caminho = req.url.split('?')[0];
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        let corpo = null;
        try {
          corpo = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          /* binário (foto) */
        }
        chamadas.push({ caminho, url: req.url, corpo });
        const padrao = {
          '/login.fcgi': { status: 200, json: { session: 'sess1' } },
          '/create_objects.fcgi': { status: 200, json: { ids: [77] } },
          '/modify_objects.fcgi': { status: 200, json: { changes: 1 } },
          '/destroy_objects.fcgi': { status: 200, json: { changes: 1 } },
          '/user_set_image.fcgi': { status: 200, json: { success: true } },
        };
        const r = respostas[caminho] || padrao[caminho] || { status: 404, json: {} };
        res.writeHead(r.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r.json ?? {}));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        chamadas,
        device: { id: 9500, nome: 'Falso Control iD', fabricante: 'control_id', ip: '127.0.0.1', porta: port },
        fechar: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

const FOTO = Buffer.from('jpeg-falso').toString('base64');

test('enroll: caminho feliz devolve o id interno como faceId', async () => {
  const ap = await aparelho();
  try {
    const r = await controlid.executar(ap.device, { type: 'enroll', externalId: 'morador_42', nome: 'Fulano', fotoBase64: FOTO });
    assert.deepEqual(r, { ok: true, faceId: '77' });
    assert.deepEqual(ap.chamadas.map((c) => c.caminho), ['/login.fcgi', '/create_objects.fcgi', '/user_set_image.fcgi']);
  } finally {
    await ap.fechar();
  }
});

test('enroll: create_objects recusado (HTTP 4xx/5xx) → ok:false com o status, sem tentar subir a foto', async () => {
  const ap = await aparelho({ '/create_objects.fcgi': { status: 500, json: { error: 'disk full' } } });
  try {
    const r = await controlid.executar(ap.device, { type: 'enroll', externalId: 'morador_42', nome: 'Fulano', fotoBase64: FOTO });
    assert.equal(r.ok, false);
    assert.equal(r.statusCode, 500);
    assert.match(r.error, /create_objects.*HTTP 500/);
    assert.ok(!ap.chamadas.some((c) => c.caminho === '/user_set_image.fcgi'));
  } finally {
    await ap.fechar();
  }
});

test('enroll: user_set_image recusado (HTTP 400) → ok:false com erro claro, não ok:true cego', async () => {
  const ap = await aparelho({ '/user_set_image.fcgi': { status: 400, json: { error: 'Face not detected' } } });
  try {
    const r = await controlid.executar(ap.device, { type: 'enroll', externalId: 'morador_42', nome: 'Fulano', fotoBase64: FOTO });
    assert.equal(r.ok, false);
    assert.equal(r.statusCode, 400);
    assert.match(r.error, /user_set_image.*HTTP 400/);
    assert.equal(r.faceId, '77', 'o usuário foi criado: o id volta junto para a nuvem saber');
  } finally {
    await ap.fechar();
  }
});

test('enroll: user_set_image HTTP 200 com success:false → ok:false (o aparelho disse que não gravou o rosto)', async () => {
  const ap = await aparelho({ '/user_set_image.fcgi': { status: 200, json: { success: false, errors: [{ code: 2, message: 'Face not detected' }] } } });
  try {
    const r = await controlid.executar(ap.device, { type: 'enroll', externalId: 'morador_42', nome: 'Fulano', fotoBase64: FOTO });
    assert.equal(r.ok, false);
    assert.match(r.error, /user_set_image/);
    assert.match(r.error, /Face not detected/);
  } finally {
    await ap.fechar();
  }
});

test('enroll: sem externalId e sem faceId é recusado sem falar com o aparelho (não cria a matrícula "undefined")', async () => {
  const ap = await aparelho();
  try {
    const r = await controlid.executar(ap.device, { type: 'enroll', nome: 'Fulano' });
    assert.equal(r.ok, false);
    assert.match(r.error, /externalId|faceId/);
    assert.equal(ap.chamadas.length, 0);
  } finally {
    await ap.fechar();
  }
});

test('update: modify_objects recusado → ok:false; não segue para a foto', async () => {
  const ap = await aparelho({ '/modify_objects.fcgi': { status: 500, json: {} } });
  try {
    const r = await controlid.executar(ap.device, { type: 'update', faceId: '77', nome: 'Novo Nome', fotoBase64: FOTO });
    assert.equal(r.ok, false);
    assert.equal(r.statusCode, 500);
    assert.match(r.error, /modify_objects.*HTTP 500/);
    assert.ok(!ap.chamadas.some((c) => c.caminho === '/user_set_image.fcgi'));
  } finally {
    await ap.fechar();
  }
});

test('update: user_set_image recusado → ok:false', async () => {
  const ap = await aparelho({ '/user_set_image.fcgi': { status: 413, json: {} } });
  try {
    const r = await controlid.executar(ap.device, { type: 'update', faceId: '77', fotoBase64: FOTO });
    assert.equal(r.ok, false);
    assert.equal(r.statusCode, 413);
    assert.match(r.error, /user_set_image.*HTTP 413/);
  } finally {
    await ap.fechar();
  }
});

test('update: caminho feliz continua ok:true com o mesmo faceId e o filtro where numérico', async () => {
  const ap = await aparelho();
  try {
    const r = await controlid.executar(ap.device, { type: 'update', faceId: '77', nome: 'Novo Nome', fotoBase64: FOTO });
    assert.deepEqual(r, { ok: true, faceId: '77' });
    const modify = ap.chamadas.find((c) => c.caminho === '/modify_objects.fcgi');
    assert.deepEqual(modify.corpo.where, { users: { id: 77 } });
  } finally {
    await ap.fechar();
  }
});

test('update/remove: faceId NÃO numérico é recusado com ok:false SEM chamar o aparelho (NaN viraria `id: null` no where)', async () => {
  const ap = await aparelho();
  try {
    for (const faceId of ['morador_42', 'abc', '', '  ', undefined, null, '12abc', '1.5', '-3', NaN, {}]) {
      for (const type of ['update', 'remove']) {
        const r = await controlid.executar(ap.device, { type, faceId, nome: 'X', fotoBase64: FOTO });
        assert.equal(r.ok, false, `${type} faceId=${String(faceId)}`);
        assert.match(r.error, /faceId/, `${type} faceId=${String(faceId)}`);
      }
    }
    assert.equal(ap.chamadas.length, 0, 'nem login');
  } finally {
    await ap.fechar();
  }
});

test('remove: faceId numérico (string ou número) segue normal', async () => {
  const ap = await aparelho();
  try {
    assert.deepEqual(await controlid.executar(ap.device, { type: 'remove', faceId: '77' }), { ok: true, statusCode: 200 });
    assert.deepEqual(await controlid.executar(ap.device, { type: 'remove', faceId: 78 }), { ok: true, statusCode: 200 });
    const destroys = ap.chamadas.filter((c) => c.caminho === '/destroy_objects.fcgi');
    assert.deepEqual(destroys.map((c) => c.corpo.where.users.id), [77, 78]);
  } finally {
    await ap.fechar();
  }
});

test('remove_users: id não numérico no lote conta como falha daquele item, sem derrubar os outros nem chamar o aparelho por ele', async () => {
  const ap = await aparelho();
  try {
    const r = await controlid.executar(ap.device, { type: 'remove_users', faceIds: ['77', 'morador_9'] });
    assert.equal(r.ok, false);
    assert.match(r.error, /1\/2/);
    const destroys = ap.chamadas.filter((c) => c.caminho === '/destroy_objects.fcgi');
    assert.deepEqual(destroys.map((c) => c.corpo.where.users.id), [77]);
  } finally {
    await ap.fechar();
  }
});
