'use strict';

/**
 * agent/src/drivers/registro.js — resolverDriver() (comandos: por família do
 * fabricante, qualquer tipo) e resolverDriverDeEventos() (ouvinte facial: só
 * tipo 'facial'), com fabricante normalizado (intelbras/dahua = mesma família).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolverDriver, resolverDriverDeEventos, FAMILIA_POR_FABRICANTE } = require('../src/drivers/registro');
const dahuaFacial = require('../src/drivers/dahua-facial');
const hikvisionFacial = require('../src/drivers/hikvision-facial');
const controlidFacial = require('../src/drivers/controlid-facial');

test('resolverDriver(): facial/intelbras devolve o driver dahua-facial', () => {
  const driver = resolverDriver({ tipo: 'facial', fabricante: 'intelbras' });
  assert.equal(driver, dahuaFacial);
  assert.equal(driver.id, 'dahua-facial');
});

test('resolverDriver(): facial/dahua (fabricante normalizado) devolve o MESMO driver', () => {
  const driver = resolverDriver({ tipo: 'facial', fabricante: 'dahua' });
  assert.equal(driver, dahuaFacial);
});

test('resolverDriver(): facial/hikvision devolve o driver hikvision-facial', () => {
  const driver = resolverDriver({ tipo: 'facial', fabricante: 'hikvision' });
  assert.equal(driver, hikvisionFacial);
  assert.equal(driver.id, 'hikvision-facial');
});

test('resolverDriver(): facial/control_id devolve o driver controlid-facial', () => {
  const driver = resolverDriver({ tipo: 'facial', fabricante: 'control_id' });
  assert.equal(driver, controlidFacial);
  assert.equal(driver.id, 'controlid-facial');
});

test('resolverDriver(): fabricante sem driver devolve null', () => {
  assert.equal(resolverDriver({ tipo: 'facial', fabricante: 'zkteco' }), null);
  assert.equal(resolverDriver({ tipo: 'catraca', fabricante: 'generico' }), null);
  // Nome de propriedade herdada de Object não pode virar "driver".
  assert.equal(resolverDriver({ tipo: 'facial', fabricante: 'toString' }), null);
});

test('resolverDriver(): COMANDOS resolvem pela família do fabricante, qualquer que seja o tipo (catraca/botoeira/leitores/LPR)', () => {
  // Regressão (C2 da revisão final): resolver por (tipo, fabricante) fazia
  // uma catraca Control iD cair no REST genérico — open_door num POST
  // /open_door que o aparelho não entende e ping em GET /status (offline).
  for (const tipo of ['catraca', 'botoeira', 'tag_reader', 'qrcode_reader', 'lpr']) {
    assert.equal(resolverDriver({ tipo, fabricante: 'control_id' }), controlidFacial, tipo);
    assert.equal(resolverDriver({ tipo, fabricante: 'intelbras' }), dahuaFacial, tipo);
    assert.equal(resolverDriver({ tipo, fabricante: 'dahua' }), dahuaFacial, tipo);
    assert.equal(resolverDriver({ tipo, fabricante: 'hikvision' }), hikvisionFacial, tipo);
  }
});

test('resolverDriverDeEventos(): só tipo facial ganha ouvinte (LPR/catraca da mesma marca não)', () => {
  assert.equal(resolverDriverDeEventos({ tipo: 'facial', fabricante: 'intelbras' }), dahuaFacial);
  assert.equal(resolverDriverDeEventos({ tipo: 'facial', fabricante: 'control_id' }), controlidFacial);
  assert.equal(resolverDriverDeEventos({ tipo: 'facial', fabricante: 'hikvision' }), hikvisionFacial);
  assert.equal(resolverDriverDeEventos({ tipo: 'lpr', fabricante: 'intelbras' }), null);
  assert.equal(resolverDriverDeEventos({ tipo: 'catraca', fabricante: 'control_id' }), null);
  assert.equal(resolverDriverDeEventos({ tipo: 'botoeira', fabricante: 'hikvision' }), null);
  assert.equal(resolverDriverDeEventos({ tipo: 'facial', fabricante: 'zkteco' }), null);
  // tipo ausente = default da API ('facial')
  assert.equal(resolverDriverDeEventos({ fabricante: 'intelbras' }), dahuaFacial);
  assert.equal(resolverDriverDeEventos(null), null);
});

test('resolverDriver(): device nulo/indefinido devolve null (não lança)', () => {
  assert.equal(resolverDriver(null), null);
  assert.equal(resolverDriver(undefined), null);
  assert.equal(resolverDriver({}), null);
});

test('FAMILIA_POR_FABRICANTE: intelbras e dahua mapeiam para a família "dahua"', () => {
  assert.equal(FAMILIA_POR_FABRICANTE.intelbras, 'dahua');
  assert.equal(FAMILIA_POR_FABRICANTE.dahua, 'dahua');
});

test('driver dahua-facial expõe o contrato completo da spec', () => {
  assert.equal(dahuaFacial.id, 'dahua-facial');
  assert.equal(typeof dahuaFacial.testar, 'function');
  assert.equal(typeof dahuaFacial.executar, 'function');
  assert.equal(typeof dahuaFacial.escutar, 'function');
  assert.equal(typeof dahuaFacial.buscarDesde, 'function');
  assert.equal(typeof dahuaFacial.acertarRelogio, 'function');
});

test('driver hikvision-facial expõe o contrato (sem acertarRelogio — não existe pra essa marca)', () => {
  assert.equal(hikvisionFacial.id, 'hikvision-facial');
  assert.equal(typeof hikvisionFacial.testar, 'function');
  assert.equal(typeof hikvisionFacial.executar, 'function');
  assert.equal(typeof hikvisionFacial.escutar, 'function');
  assert.equal(typeof hikvisionFacial.buscarDesde, 'function');
  assert.equal(hikvisionFacial.acertarRelogio, undefined);
});

test('driver controlid-facial expõe o contrato (sem acertarRelogio — não existe pra essa marca)', () => {
  assert.equal(controlidFacial.id, 'controlid-facial');
  assert.equal(typeof controlidFacial.testar, 'function');
  assert.equal(typeof controlidFacial.executar, 'function');
  assert.equal(typeof controlidFacial.escutar, 'function');
  assert.equal(typeof controlidFacial.buscarDesde, 'function');
  assert.equal(controlidFacial.acertarRelogio, undefined);
});

test('resolverDriver(): fabricante normalizado (caixa, espaços, acento) e aliases por marca', () => {
  const casos = [
    ['intelbras', dahuaFacial],
    ['Intelbras', dahuaFacial],
    ['  INTELBRAS ', dahuaFacial],
    ['Íntelbras', dahuaFacial],
    ['dahua', dahuaFacial],
    ['Dahua', dahuaFacial],
    ['hikvision', hikvisionFacial],
    ['Hikvision', hikvisionFacial],
    ['HIKVISION', hikvisionFacial],
    ['hik', hikvisionFacial],
    [' Hik ', hikvisionFacial],
    ['control_id', controlidFacial],
    ['Control_ID', controlidFacial],
    ['controlid', controlidFacial],
    ['ControlID', controlidFacial],
    ['control id', controlidFacial],
    ['Control iD', controlidFacial],
    ['control-id', controlidFacial],
    ['Control-iD', controlidFacial],
  ];
  for (const [fabricante, esperado] of casos) {
    assert.equal(resolverDriver({ tipo: 'facial', fabricante }), esperado, `comando: "${fabricante}"`);
    assert.equal(resolverDriverDeEventos({ tipo: 'facial', fabricante }), esperado, `eventos: "${fabricante}"`);
  }
});

test('replayEmTodaReconexao(): só para driver que mantém a marca d\'água em dia enquanto online (Dahua/Intelbras)', () => {
  const { replayEmTodaReconexao } = require('../src/drivers/registro');
  assert.equal(replayEmTodaReconexao({ tipo: 'facial', fabricante: 'intelbras' }), true);
  assert.equal(replayEmTodaReconexao({ tipo: 'facial', fabricante: 'Dahua' }), true);
  assert.equal(replayEmTodaReconexao({ fabricante: 'intelbras' }), true);
  // Hikvision não avança a marca ao vivo: replay a cada reconexão reenviaria tudo como backlog.
  assert.equal(replayEmTodaReconexao({ tipo: 'facial', fabricante: 'hikvision' }), false);
  assert.equal(replayEmTodaReconexao({ tipo: 'facial', fabricante: 'control_id' }), false);
  assert.equal(replayEmTodaReconexao({ tipo: 'lpr', fabricante: 'intelbras' }), false);
  assert.equal(replayEmTodaReconexao({ tipo: 'facial', fabricante: 'zkteco' }), false);
  assert.equal(replayEmTodaReconexao(null), false);
});

test('resolverDriver(): normalizar não inventa driver (desconhecido, vazio, não-string, propriedade herdada)', () => {
  for (const fabricante of ['zkteco', 'ZKTeco', 'generico', '   ', 'toString', 'constructor', '__proto__', 'hikvisionx', 'control', 42, {}]) {
    assert.equal(resolverDriver({ tipo: 'facial', fabricante }), null, String(fabricante));
  }
});
