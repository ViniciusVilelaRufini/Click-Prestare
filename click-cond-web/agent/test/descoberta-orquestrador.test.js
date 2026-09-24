'use strict';
const test = require('node:test');
const assert = require('node:assert');
const dgram = require('dgram');
const http = require('http');
const { descobrir } = require('../src/descoberta');

const RESPOSTA = JSON.stringify({ mac: 'b4:4c:3b:f4:e3:01', method: 'client.notifyDevInfo', params: { deviceInfo: { DeviceType: 'SS 3530 MF FACE W', HttpPort: 80, SerialNo: 'K3', IPv4Address: { IPAddress: '127.0.0.1', DhcpEnable: true } } } });
function dhip(json) {
  const c = Buffer.from(json); const h = Buffer.alloc(32);
  h.write('\x20\x00\x00\x00DHIP', 0, 'latin1'); h.writeUInt32LE(c.length, 16); h.writeUInt32LE(c.length, 24);
  return Buffer.concat([h, c]);
}

test('descobrir junta resposta DHIP e página Control iD', async () => {
  const udp = dgram.createSocket('udp4');
  udp.on('message', (msg, r) => { if (msg.includes('DHDiscover')) udp.send(dhip(RESPOSTA), r.port, r.address); });
  await new Promise((ok) => udp.bind(0, '127.0.0.1', ok));
  const web = http.createServer((q, s) => { s.end('<title>Control iD</title>'); });
  await new Promise((ok) => web.listen(0, '127.0.0.1', ok));
  try {
    const achados = await descobrir({
      varredura: true,
      esperaMs: 800,
      destinos: [{ protocolo: 'dhip', host: '127.0.0.1', porta: udp.address().port }],
      hostsVarredura: [`127.0.0.1:${web.address().port}`],
    });
    const intel = achados.find((a) => a.fabricante === 'intelbras');
    assert.ok(intel, JSON.stringify(achados));
    assert.strictEqual(intel.mac, 'b4:4c:3b:f4:e3:01');
    const cid = achados.find((a) => a.fabricante === 'control_id');
    assert.ok(cid, JSON.stringify(achados));
    assert.strictEqual(cid.porta, web.address().port);
    assert.strictEqual(cid.validado_em_campo, false);
  } finally {
    udp.close(); web.close();
  }
});

test('sem varredura não faz HTTP; sem resposta devolve lista vazia sem lançar', async () => {
  const logOutput = [];
  const originalLog = console.log;
  console.log = (...args) => logOutput.push(args.join(''));
  try {
    const achados = await descobrir({ varredura: false, esperaMs: 300, destinos: [{ protocolo: 'dhip', host: '127.0.0.1', porta: 9 }] });
    assert.deepStrictEqual(achados, []);
    assert.strictEqual(logOutput.length, 0, 'sem resposta não deve logar nada');
  } finally {
    console.log = originalLog;
  }
});

test('UDP com host inválido loga exatamente uma linha de erro', async () => {
  const logOutput = [];
  const originalLog = console.log;
  console.log = (...args) => logOutput.push(args.join(''));
  try {
    const achados = await descobrir({
      varredura: false,
      esperaMs: 300,
      destinos: [{ protocolo: 'dhip', host: '256.1.1.1', porta: 47810 }],
    });
    assert.deepStrictEqual(achados, []);
    const erroLogs = logOutput.filter((l) => l.includes('[agente] descoberta:'));
    assert.strictEqual(erroLogs.length, 1, `esperava exatamente 1 log de erro, got ${erroLogs.length}: ${JSON.stringify(erroLogs)}`);
    assert.match(erroLogs[0], /\[agente\] descoberta: \d+ falha\(s\) de rede ignorada\(s\)/);
  } finally {
    console.log = originalLog;
  }
});
