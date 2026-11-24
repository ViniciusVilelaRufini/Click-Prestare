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
    for (const faceId of ['abc', '', '  ', undefined, null, '12abc', '1.5', '-3', NaN, {}]) {
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

// ---------- Q4: com 2+ Control iD, o face_id salvo é o id interno de UM aparelho ----------

/** Usuários do aparelho falso: 77 é OUTRA pessoa (o id que o 1º aparelho deu ao morador_42). */
const USUARIOS = {
  '/load_objects.fcgi': {
    status: 200,
    json: {
      users: [
        { id: 5, name: 'Fulano', registration: 'morador_42' },
        { id: 77, name: 'Outra pessoa', registration: 'morador_9' },
      ],
    },
  },
};

test('Q4 update: com externalId, resolve o usuário pela matrícula NESTE aparelho (nunca pelo id do outro aparelho)', async () => {
  const ap = await aparelho(USUARIOS);
  try {
    const r = await controlid.executar(ap.device, {
      type: 'update', faceId: '77', externalId: 'morador_42', nome: 'Fulano Novo', fotoBase64: FOTO,
    });
    assert.deepEqual(r, { ok: true, faceId: '5' });
    const load = ap.chamadas.find((c) => c.caminho === '/load_objects.fcgi');
    assert.deepEqual(load.corpo.where, { users: { registration: 'morador_42' } });
    const modify = ap.chamadas.find((c) => c.caminho === '/modify_objects.fcgi');
    assert.deepEqual(modify.corpo.where, { users: { id: 5 } });
    const foto = ap.chamadas.find((c) => c.caminho === '/user_set_image.fcgi');
    assert.match(foto.url, /user_id=5&/);
    assert.ok(!ap.chamadas.some((c) => JSON.stringify(c.corpo ?? '').includes('"id":77') || /user_id=77/.test(c.url)), 'o 77 (outra pessoa) não é tocado');
  } finally {
    await ap.fechar();
  }
});

test('Q4 update: pessoa ainda não está NESTE aparelho → é criada aqui com a matrícula (não modifica o id de outro)', async () => {
  const ap = await aparelho({ '/load_objects.fcgi': { status: 200, json: { users: [{ id: 77, registration: 'morador_9' }] } } });
  try {
    const r = await controlid.executar(ap.device, {
      type: 'update', faceId: '77', externalId: 'morador_42', nome: 'Fulano', fotoBase64: FOTO,
    });
    assert.deepEqual(r, { ok: true, faceId: '77' }, 'o create do aparelho falso devolve o id 77');
    assert.ok(!ap.chamadas.some((c) => c.caminho === '/modify_objects.fcgi'));
    const create = ap.chamadas.find((c) => c.caminho === '/create_objects.fcgi');
    assert.deepEqual(create.corpo.values, [{ name: 'Fulano', registration: 'morador_42' }]);
  } finally {
    await ap.fechar();
  }
});

test('Q4 update/remove: faceId no nosso formato (gravado por um Dahua do mesmo condomínio) também resolve pela matrícula', async () => {
  const ap = await aparelho(USUARIOS);
  try {
    assert.deepEqual(await controlid.executar(ap.device, { type: 'update', faceId: 'morador_42', nome: 'F' }), { ok: true, faceId: '5' });
    assert.deepEqual(await controlid.executar(ap.device, { type: 'remove', faceId: 'morador_42' }), { ok: true, statusCode: 200 });
    const destroys = ap.chamadas.filter((c) => c.caminho === '/destroy_objects.fcgi');
    assert.deepEqual(destroys.map((c) => c.corpo.where), [{ users: { id: 5 } }]);
  } finally {
    await ap.fechar();
  }
});

test('Q4 remove: com externalId, apaga só quem tem a matrícula NESTE aparelho; ninguém com ela → ok sem apagar nada', async () => {
  const ap = await aparelho(USUARIOS);
  try {
    assert.deepEqual(
      await controlid.executar(ap.device, { type: 'remove', faceId: '77', externalId: 'morador_42' }),
      { ok: true, statusCode: 200 },
    );
    assert.deepEqual(
      await controlid.executar(ap.device, { type: 'remove', faceId: '5', externalId: 'visitante_3' }),
      { ok: true },
    );
    const destroys = ap.chamadas.filter((c) => c.caminho === '/destroy_objects.fcgi');
    assert.deepEqual(destroys.map((c) => c.corpo.where), [{ users: { id: 5 } }], 'nem o 77 nem o 5 da 2ª chamada');
  } finally {
    await ap.fechar();
  }
});

test('Q4: leitura dos usuários recusada → falha sem modificar nem apagar ninguém', async () => {
  const ap = await aparelho({ '/load_objects.fcgi': { status: 500, json: {} } });
  try {
    for (const type of ['update', 'remove']) {
      await assert.rejects(
        controlid.executar(ap.device, { type, faceId: '77', externalId: 'morador_42', nome: 'X' }),
        /load_objects.*HTTP 500/,
      );
    }
    assert.ok(!ap.chamadas.some((c) => ['/modify_objects.fcgi', '/destroy_objects.fcgi', '/create_objects.fcgi'].includes(c.caminho)));
  } finally {
    await ap.fechar();
  }
});

// ---------- Q6: abrir porta não sai depois do prazo do comando ----------

test('Q6 open_door: prazo acabou durante o login → não aciona a porta', async () => {
  const ap = await aparelho();
  try {
    let restante = 2000;
    const cmd = { type: 'open_door', _prazoRestanteMs: () => restante };
    // O login "leva" o resto do prazo.
    const original = ap.chamadas.push.bind(ap.chamadas);
    ap.chamadas.push = (c) => {
      if (c.caminho === '/login.fcgi') restante = 0;
      return original(c);
    };
    const r = await controlid.executar(ap.device, cmd);
    assert.equal(r.ok, false);
    assert.match(r.error, /prazo/);
    assert.deepEqual(ap.chamadas.map((c) => c.caminho), ['/login.fcgi']);
  } finally {
    await ap.fechar();
  }
});

test('Q6 open_door: com prazo sobrando (ou sem prazo conhecido) abre normalmente', async () => {
  const ap = await aparelho({ '/execute_actions.fcgi': { status: 200, json: {} } });
  try {
    assert.equal((await controlid.executar(ap.device, { type: 'open_door', _prazoRestanteMs: () => 5000 })).ok, true);
    assert.equal((await controlid.executar(ap.device, { type: 'open_door' })).ok, true);
    assert.equal(ap.chamadas.filter((c) => c.caminho === '/execute_actions.fcgi').length, 2);
  } finally {
    await ap.fechar();
  }
});
