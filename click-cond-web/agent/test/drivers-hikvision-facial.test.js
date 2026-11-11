'use strict';

/**
 * agent/src/drivers/hikvision-facial.js — contra um aparelho FALSO (servidor
 * HTTP local em 127.0.0.1): recusa de cadastro sem identificador e o ciclo
 * de vida do ouvinte (`parar()` fecha a conexão do stream).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const hikvision = require('../src/drivers/hikvision-facial');

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

test('enroll: sem externalId e sem faceId é recusado sem falar com o aparelho (não cria o employeeNo "undefined")', async () => {
  let chamadas = 0;
  const server = http.createServer((req, res) => {
    chamadas++;
    res.end('{}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const device = { id: 9700, nome: 'Falso Hik', fabricante: 'hikvision', ip: '127.0.0.1', porta: server.address().port };
    const r = await hikvision.executar(device, { type: 'enroll', nome: 'Fulano' });
    assert.equal(r.ok, false);
    assert.match(r.error, /externalId|faceId/);
    assert.equal(chamadas, 0);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('escutar(): parar() FECHA a conexão do stream aberto (trocar a senha no portal não deixa dois streams no aparelho)', async () => {
  let streamsAbertos = 0;
  let streamsFechados = 0;
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    if (!/^Digest /.test(req.headers.authorization || '')) {
      res.writeHead(401, { 'WWW-Authenticate': 'Digest realm="r", nonce="n", qop="auth"' });
      return res.end();
    }
    streamsAbertos++;
    res.on('close', () => streamsFechados++);
    res.writeHead(200, { 'Content-Type': 'multipart/mixed; boundary=boundary' });
    res.write('--boundary\r\n');
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const device = { id: 9701, nome: 'Falso Hik', fabricante: 'hikvision', ip: '127.0.0.1', porta: server.address().port, api_user: 'admin', api_password: 'x' };
  let conexoes = 0;
  const parar = hikvision.escutar(device, () => {}, { aoConectar: () => conexoes++ });
  try {
    await espera(150);
    assert.equal(streamsAbertos, 1);
    assert.equal(conexoes, 1);
    assert.equal(streamsFechados, 0);
    parar();
    await espera(150);
    assert.equal(streamsFechados, 1, 'o stream antigo foi encerrado pelo agente');
    assert.equal(streamsAbertos, 1, 'e não reabriu depois de parado');
  } finally {
    parar();
    for (const s of sockets) s.destroy();
    await new Promise((r) => server.close(r));
  }
});
