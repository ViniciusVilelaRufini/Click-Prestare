'use strict';

/**
 * agent/src/drivers/registro.js — resolverDriver() por (tipo, fabricante),
 * com fabricante normalizado (intelbras/dahua caem na mesma família).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolverDriver, FAMILIA_POR_FABRICANTE } = require('../src/drivers/registro');
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

test('resolverDriver(): combinação (tipo, fabricante) desconhecida devolve null', () => {
  assert.equal(resolverDriver({ tipo: 'lpr', fabricante: 'intelbras' }), null);
  assert.equal(resolverDriver({ tipo: 'facial', fabricante: 'zkteco' }), null);
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
