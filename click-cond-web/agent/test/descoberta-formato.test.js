'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { normalizarMac, agruparPorMac } = require('../src/descoberta/formato');
const dahua = require('../src/descoberta/dahua');
const hik = require('../src/descoberta/hikvision');
const cid = require('../src/descoberta/controlid');
const { interpretarArp } = require('../src/descoberta/arp');

const RESPOSTA_REAL = '{"mac":"b4:4c:3b:f4:e3:01","method":"client.notifyDevInfo","params":{"deviceInfo":{"DeviceClass":"BSC","DeviceType":"SS 3530 MF FACE W","HttpPort":80,"IPv4Address":{"DefaultGateway":"192.168.3.1","DhcpEnable":true,"IPAddress":"192.168.3.175","SubnetMask":"255.255.255.0"},"Manufacturer":"Intelbras","SerialNo":"K3LJ3400209RH","Vendor":"Intelbras","Version":"2.000.00IB004.0.R"}}}';

function comCabecalho(json) {
  const corpo = Buffer.from(json);
  const h = Buffer.alloc(32);
  h.write('\x20\x00\x00\x00DHIP', 0, 'latin1');
  h.writeUInt32LE(corpo.length, 16);
  h.writeUInt32LE(corpo.length, 24);
  return Buffer.concat([h, corpo]);
}

test('normalizarMac aceita traços, maiúsculas e 12 hex; rejeita lixo', () => {
  assert.strictEqual(normalizarMac('B4-4C-3B-F4-E3-01'), 'b4:4c:3b:f4:e3:01');
  assert.strictEqual(normalizarMac('b44c3bf4e301'), 'b4:4c:3b:f4:e3:01');
  assert.strictEqual(normalizarMac('ff-ff-ff-ff-ff-ff'), null);
  assert.strictEqual(normalizarMac('00:00:00:00:00:00'), null);
  assert.strictEqual(normalizarMac('xyz'), null);
  assert.strictEqual(normalizarMac(undefined), null);
});

test('pacote DHIP tem cabeçalho de 32 bytes com o tamanho do JSON', () => {
  const p = dahua.montarPacoteDhip();
  assert.strictEqual(p.subarray(4, 8).toString('latin1'), 'DHIP');
  const tam = p.readUInt32LE(16);
  assert.strictEqual(p.readUInt32LE(24), tam);
  assert.strictEqual(p.length, 32 + tam);
  assert.deepStrictEqual(JSON.parse(p.subarray(32).toString()), {
    method: 'DHDiscover.search', params: { mac: '', uni: 1 },
  });
});

test('interpreta a resposta DHIP real do SS 3530 MF', () => {
  const a = dahua.interpretarRespostaDhip(comCabecalho(RESPOSTA_REAL));
  assert.deepStrictEqual(a, {
    mac: 'b4:4c:3b:f4:e3:01', ip: '192.168.3.175', porta: 80, fabricante: 'intelbras',
    modelo: 'SS 3530 MF FACE W', numero_serie: 'K3LJ3400209RH', dhcp: true, validado_em_campo: true, classe: 'BSC',
  });
});

test('DHIP: aceita o "\\n\\0" que o SS 3530 MF real põe depois do JSON', () => {
  // Bytes reais (24/09): o tamanho do cabeçalho inclui o '\n' e o byte nulo finais.
  const a = dahua.interpretarRespostaDhip(comCabecalho(RESPOSTA_REAL + '\n\u0000'));
  assert.ok(a, 'resposta real com terminador nulo foi descartada');
  assert.strictEqual(a.mac, 'b4:4c:3b:f4:e3:01');
  assert.strictEqual(a.ip, '192.168.3.175');
});

test('DHIP: ignora o próprio pedido (DHDiscover.search) e lixo', () => {
  assert.strictEqual(dahua.interpretarRespostaDhip(dahua.montarPacoteDhip()), null);
  assert.strictEqual(dahua.interpretarRespostaDhip(Buffer.from('oi')), null);
});

test('interpreta ProbeMatch SADP (Hikvision, não validado em campo)', () => {
  const xml = '<?xml version="1.0" encoding="UTF-8"?><ProbeMatch><Uuid>X</Uuid><Types>inquiry</Types><DeviceType>135340</DeviceType><DeviceDescription>DS-K1T671M</DeviceDescription><DeviceSN>DS-K1T671M20210101AAWRF12345678</DeviceSN><CommandPort>8000</CommandPort><HttpPort>80</HttpPort><MAC>44-19-b6-aa-bb-cc</MAC><IPv4Address>192.168.3.64</IPv4Address><DHCP>false</DHCP></ProbeMatch>';
  assert.deepStrictEqual(hik.interpretarRespostaSadp(Buffer.from(xml)), {
    mac: '44:19:b6:aa:bb:cc', ip: '192.168.3.64', porta: 80, fabricante: 'hikvision',
    modelo: 'DS-K1T671M', numero_serie: 'DS-K1T671M20210101AAWRF12345678', dhcp: false, validado_em_campo: false, classe: null,
  });
  assert.strictEqual(hik.interpretarRespostaSadp(hik.montarProbeSadp('ABC')), null);
});

test('reconhece a página do Control iD; hosts da /24', () => {
  assert.strictEqual(cid.pareceControlId({ status: 200, headers: {}, corpo: '<title>Control iD</title>' }), true);
  assert.strictEqual(cid.pareceControlId({ status: 200, headers: { server: 'lighttpd' }, corpo: '<html>controlid.com.br</html>' }), true);
  assert.strictEqual(cid.pareceControlId({ status: 401, headers: { 'www-authenticate': 'Digest realm="Login to K3LJ"' }, corpo: '' }), false);
  const hosts = cid.hostsDaSubrede('192.168.3.74', '255.255.255.0');
  assert.strictEqual(hosts.length, 253);
  assert.ok(!hosts.includes('192.168.3.74') && hosts.includes('192.168.3.1') && hosts.includes('192.168.3.254'));
  assert.deepStrictEqual(cid.hostsDaSubrede('172.26.144.1', '255.255.240.0'), []);
});

test('interpreta a saída do arp -a do Windows', () => {
  const texto = '\r\nInterface: 192.168.3.74 --- 0x7\r\n  Endereço IP           Endereço físico       Tipo\r\n  192.168.3.1           a0-b1-c2-d3-e4-f5     dinâmico\r\n  192.168.3.175         b4-4c-3b-f4-e3-01     dinâmico\r\n  192.168.3.255         ff-ff-ff-ff-ff-ff     estático\r\n';
  const m = interpretarArp(texto);
  assert.strictEqual(m.get('192.168.3.175'), 'b4:4c:3b:f4:e3:01');
  assert.strictEqual(m.get('192.168.3.1'), 'a0:b1:c2:d3:e4:f5');
  assert.strictEqual(m.has('192.168.3.255'), false);
});

test('agruparPorMac funde o mesmo aparelho e mantém sem-MAC por IP', () => {
  const base = { porta: 80, fabricante: 'intelbras', modelo: null, numero_serie: null, dhcp: null, validado_em_campo: true, classe: null };
  const r = agruparPorMac([
    { ...base, mac: 'b4:4c:3b:f4:e3:01', ip: '192.168.3.175' },
    { ...base, mac: 'b4:4c:3b:f4:e3:01', ip: '192.168.3.175', modelo: 'SS 3530', numero_serie: 'K3', classe: 'BSC' },
    { ...base, mac: null, ip: '192.168.3.9', fabricante: 'control_id', validado_em_campo: false },
    { ...base, mac: null, ip: '192.168.3.9', fabricante: 'control_id', validado_em_campo: false },
  ]);
  assert.strictEqual(r.length, 2);
  const f = r.find((a) => a.mac);
  assert.strictEqual(f.modelo, 'SS 3530');
  assert.strictEqual(f.numero_serie, 'K3');
  assert.strictEqual(f.classe, 'BSC');
});
