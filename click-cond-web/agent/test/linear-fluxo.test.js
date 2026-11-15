'use strict';

/**
 * agent/src/drivers/linear/fluxo.js — separação do fluxo TCP do Guarita em
 * frames (Review Focus 1: fragmentado, colado, evento no meio de leitura
 * progressiva, lixo e checksum errado). Frames escritos à mão; o checksum
 * dos frames longos é somado por um auxiliar LOCAL (não pelo codec).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { LeitorDeFluxo } = require('../src/drivers/linear/fluxo');

const h = (s) => Buffer.from(s.replace(/\s+/g, ''), 'hex');
const hex = (b) => b.toString('hex').toUpperCase();
/** Acrescenta o checksum (soma mod 256) — conta feita aqui, à parte do codec. */
function comCs(hexSemCs) {
  const b = h(hexSemCs);
  let s = 0;
  for (const x of b) s = (s + x) % 256;
  return Buffer.concat([b, Buffer.from([s])]);
}

const EVT = '01A2B3C4 143005 151126 10 0308 01 10 00';
const F4 = comCs(`00 04 07 ${EVT}`); // evento automático, 20 bytes
const F7 = h('00 07 00 02 09'); // 2 dispositivos
const F12 = h('00 0C 15 11 26 14 30 05 A1');
const DISP = '11A2B3C4 1234 0308 01 00 FF' + '4D41524941' + '20'.repeat(13) + '00 06 0A' + '41424331443233';
const F70 = comCs(`00 46 ${DISP}`); // 42 bytes

function novoLeitor() {
  const frames = [];
  const lixos = [];
  const leitor = new LeitorDeFluxo({ aoFrame: (f) => frames.push(f), aoLixo: (l) => lixos.push(l) });
  return { leitor, frames, lixos };
}

test('vetores locais: tamanhos esperados', () => {
  assert.equal(F4.length, 20);
  assert.equal(F70.length, 42);
  assert.equal(hex(F4).slice(-2), 'E6'); // conferido à mão
});

test('frame entregue um byte por vez', () => {
  const { leitor, frames, lixos } = novoLeitor();
  for (const b of F70) leitor.alimentar(Buffer.from([b]));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].comando, 0x46);
  assert.equal(frames[0].dados.length, 39);
  assert.equal(hex(frames[0].bruto), hex(F70));
  assert.equal(lixos.length, 0);
});

test('dois frames colados no mesmo pacote', () => {
  const { leitor, frames } = novoLeitor();
  leitor.alimentar(Buffer.concat([F7, F12]));
  assert.deepEqual(frames.map((f) => f.comando), [0x07, 0x0c]);
  assert.equal(hex(frames[0].dados), '0002');
  assert.equal(hex(frames[1].dados), '151126143005');
});

test('evento do comando 4 no meio de uma leitura do 70: os dois chegam certos, em qualquer fatiamento', () => {
  const fluxo = Buffer.concat([F70, F4, F70]);
  for (let corte1 = 1; corte1 < fluxo.length - 1; corte1 += 7) {
    for (const corte2 of [corte1 + 1, corte1 + 13, fluxo.length - 1]) {
      if (corte2 <= corte1 || corte2 >= fluxo.length) continue;
      const { leitor, frames, lixos } = novoLeitor();
      leitor.alimentar(fluxo.subarray(0, corte1));
      leitor.alimentar(fluxo.subarray(corte1, corte2));
      leitor.alimentar(fluxo.subarray(corte2));
      assert.deepEqual(frames.map((f) => f.comando), [0x46, 0x04, 0x46], `cortes ${corte1}/${corte2}`);
      assert.equal(hex(frames[1].bruto), hex(F4));
      assert.equal(lixos.length, 0);
    }
  }
});

test('checksum errado: descartado em aoLixo e o frame seguinte chega', () => {
  const { leitor, frames, lixos } = novoLeitor();
  const ruim = h('00 07 00 02 0A');
  leitor.alimentar(Buffer.concat([ruim, F12]));
  assert.deepEqual(frames.map((f) => f.comando), [0x0c]);
  assert.equal(hex(Buffer.concat(lixos)), hex(ruim));
});

test('ressincroniza depois de lixo (bytes soltos, 0x00 extra antes do frame, comando desconhecido)', () => {
  const { leitor, frames, lixos } = novoLeitor();
  leitor.alimentar(h('FF 12 34'));
  leitor.alimentar(Buffer.concat([h('00'), F7])); // 0x00 sobrando da autorização
  leitor.alimentar(h('00 99 01 02'));
  leitor.alimentar(F12);
  assert.deepEqual(frames.map((f) => f.comando), [0x07, 0x0c]);
  assert.equal(hex(Buffer.concat(lixos)), 'FF123400' + '00990102');
});

test('pacote 33 (dois eventos) é delimitado pelo checksum', () => {
  const { leitor, frames } = novoLeitor();
  const p33 = comCs(`00 21 ${EVT} ${EVT}`);
  assert.equal(p33.length, 35);
  leitor.alimentar(p33.subarray(0, 20));
  leitor.alimentar(Buffer.concat([p33.subarray(20), F7]));
  assert.deepEqual(frames.map((f) => f.comando), [0x21, 0x07]);
  assert.equal(frames[0].dados.length, 32);
});

test('resposta do 67: 5 bytes; leitura (opção 3) com sucesso: 44 bytes', () => {
  const { leitor, frames } = novoLeitor();
  leitor.alimentar(h('00 43 00 02 45'));
  leitor.alimentar(comCs(`00 43 03 00 ${DISP}`));
  assert.equal(frames.length, 2);
  assert.equal(frames[0].bruto.length, 5);
  assert.equal(frames[1].bruto.length, 44);
});

test('destravar: início de frame falso dentro de lixo não segura a resposta para sempre', () => {
  const { leitor, frames } = novoLeitor();
  // "00 46" falso (pediria 42 bytes) seguido da resposta real do 7.
  leitor.alimentar(Buffer.concat([h('00 46 33'), F7]));
  assert.equal(frames.length, 0);
  leitor.destravar();
  assert.deepEqual(frames.map((f) => f.comando), [0x07]);
  assert.equal(leitor.pendentes, 0);
});
