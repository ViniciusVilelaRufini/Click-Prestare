'use strict';

/**
 * agent/src/core/estado.js — configDir(), lerJson/gravarJsonAtomico
 * (persistência genérica) e a marca d'água (baseline) de cada device.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  configDir,
  lerJson,
  gravarJsonAtomico,
  deviceBaselines,
  baselinesPath,
  loadBaselines,
  setBaseline,
} = require('../src/core/estado');

// Arquivos usados pelos testes ficam em configDir() (mesma pasta do módulo,
// fora do bundle) — sempre removidos no `finally` para não sujar o repo
// (o diretório já está no .gitignore, mas evita ruído entre execuções).
function limpar(nome) {
  const p = path.join(configDir(), nome);
  for (const alvo of [p, `${p}.tmp`]) {
    try {
      fs.unlinkSync(alvo);
    } catch { /* já não existe */ }
  }
}

test('lerJson(): devolve o padrão quando o arquivo não existe', () => {
  const nome = 'estado-teste-inexistente.json';
  limpar(nome);
  assert.deepEqual(lerJson(nome, { vazio: true }), { vazio: true });
});

test('lerJson(): devolve o padrão quando o arquivo está corrompido', () => {
  const nome = 'estado-teste-corrompido.json';
  limpar(nome);
  try {
    fs.writeFileSync(path.join(configDir(), nome), '{ isso não é json', 'utf8');
    assert.deepEqual(lerJson(nome, { padrao: 1 }), { padrao: 1 });
  } finally {
    limpar(nome);
  }
});

test('gravarJsonAtomico() + lerJson(): grava e relê o mesmo objeto', () => {
  const nome = 'estado-teste-roundtrip.json';
  limpar(nome);
  try {
    gravarJsonAtomico(nome, { a: 1, b: 'dois' });
    assert.deepEqual(lerJson(nome, null), { a: 1, b: 'dois' });
  } finally {
    limpar(nome);
  }
});

test('gravarJsonAtomico(): arquivo final fica íntegro mesmo com um .tmp velho pré-existente', () => {
  const nome = 'estado-teste-atomico.json';
  limpar(nome);
  try {
    const destino = path.join(configDir(), nome);
    // Simula um .tmp deixado por uma escrita anterior interrompida.
    fs.writeFileSync(`${destino}.tmp`, 'lixo de uma gravação anterior que morreu no meio', 'utf8');

    gravarJsonAtomico(nome, { ok: true });

    assert.equal(fs.readFileSync(destino, 'utf8'), JSON.stringify({ ok: true }));
    // O rename consome o .tmp — não deve sobrar lixo ao lado do arquivo final.
    assert.equal(fs.existsSync(`${destino}.tmp`), false);
  } finally {
    limpar(nome);
  }
});

test('gravarJsonAtomico(): sobrescreve o destino já existente (não concatena)', () => {
  const nome = 'estado-teste-sobrescreve.json';
  limpar(nome);
  try {
    gravarJsonAtomico(nome, { versao: 1 });
    gravarJsonAtomico(nome, { versao: 2 });
    assert.deepEqual(lerJson(nome, null), { versao: 2 });
  } finally {
    limpar(nome);
  }
});

test('baselinesPath(): aponta para device-baselines.json dentro de configDir()', () => {
  assert.equal(baselinesPath(), path.join(configDir(), 'device-baselines.json'));
});

test('baselines: setBaseline() grava em disco e loadBaselines() recarrega em um Map limpo', () => {
  limpar('device-baselines.json');
  try {
    setBaseline(11, 100);
    setBaseline(22, 200);
    assert.equal(deviceBaselines.get(11), 100);
    assert.equal(deviceBaselines.get(22), 200);

    // Persistiu no formato esperado: objeto chave(string)->valor.
    const gravado = JSON.parse(fs.readFileSync(baselinesPath(), 'utf8'));
    assert.deepEqual(gravado, { '11': 100, '22': 200 });

    // Simula reiniciar o processo: zera o Map em memória e recarrega do disco.
    deviceBaselines.clear();
    assert.equal(deviceBaselines.size, 0);
    loadBaselines();
    assert.equal(deviceBaselines.get(11), 100);
    assert.equal(deviceBaselines.get(22), 200);
  } finally {
    deviceBaselines.clear();
    limpar('device-baselines.json');
  }
});

test('baselines: loadBaselines() em cima de arquivo inexistente não lança e não altera o Map', () => {
  limpar('device-baselines.json');
  deviceBaselines.clear();
  try {
    loadBaselines();
    assert.equal(deviceBaselines.size, 0);
  } finally {
    deviceBaselines.clear();
    limpar('device-baselines.json');
  }
});
