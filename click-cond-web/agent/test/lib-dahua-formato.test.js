'use strict';

/**
 * agent/src/lib/dahua-formato.js — formatos de data/registro dos terminais
 * Dahua/Intelbras e ISO com offset exigido pelo ISAPI (Hikvision).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  formatDahuaTime,
  parseDahuaINI,
  dahuaEpochToISO,
  hikIsoComOffset,
} = require('../src/lib/dahua-formato');

test('formatDahuaTime(): "YYYY-MM-DD HH:MM:SS" com zero-padding', () => {
  const d = new Date(2026, 0, 5, 9, 3, 7); // 5/jan/2026 09:03:07 local
  assert.equal(formatDahuaTime(d), '2026-01-05 09:03:07');
});

test('parseDahuaINI(): agrupa "records[i].Campo=valor" por índice', () => {
  const text = [
    'found=2',
    'records[0].RecNo=101',
    'records[0].UserID=morador_42',
    'records[0].CreateTime=1700000000',
    'records[1].RecNo=102',
    'records[1].UserID=morador_7',
    '',
    'linha sem igual',
  ].join('\r\n');

  const records = parseDahuaINI(text);
  assert.equal(records.length, 2);
  assert.equal(records[0].RecNo, '101');
  assert.equal(records[0].UserID, 'morador_42');
  assert.equal(records[0].CreateTime, '1700000000');
  assert.equal(records[1].RecNo, '102');
  assert.equal(records[1].UserID, 'morador_7');
});

test('parseDahuaINI(): ignora linhas vazias e sem "="', () => {
  const records = parseDahuaINI('\r\n  \r\nlixo\r\nrecords[0].UserID=x\r\n');
  assert.equal(records.length, 1);
  assert.equal(records[0].UserID, 'x');
});

test('dahuaEpochToISO(): epoch unix válido vira ISO correspondente', () => {
  const epoch = 1700000000; // 2023-11-14T22:13:20.000Z
  assert.equal(dahuaEpochToISO(String(epoch)), new Date(epoch * 1000).toISOString());
});

test('dahuaEpochToISO(): relógio zerado (< 2020) cai para "agora"', () => {
  const antes = Date.now();
  const iso = dahuaEpochToISO('0');
  const depois = Date.now();
  const ms = new Date(iso).getTime();
  assert.ok(ms >= antes - 1000 && ms <= depois + 1000, `esperado ~agora, veio ${iso}`);
});

test('hikIsoComOffset(): ISO local sem sufixo "Z", com offset -03:00 (America/Sao_Paulo)', () => {
  const d = new Date(2026, 7, 17, 11, 30, 0); // 17/ago/2026 11:30:00 local
  const iso = hikIsoComOffset(d);
  assert.ok(!iso.endsWith('Z'), `não deveria terminar em Z: ${iso}`);
  assert.equal(iso, '2026-08-17T11:30:00-03:00');
});
