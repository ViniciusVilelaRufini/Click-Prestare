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
  dirDeConfigFora,
  lerJson,
  gravarJsonAtomico,
  deviceBaselines,
  baselinesPath,
  loadBaselines,
  setBaseline,
  RENAME_TENTATIVAS,
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

test('dirDeConfigFora(): bundle em agent/dist procura .env/estado em agent/ (pasta pai)', () => {
  // I7 da revisão final: `node agent/dist/click-agent.cjs` procurava o .env,
  // as baselines e a fila offline dentro de dist/.
  const agente = path.join(path.sep, 'x', 'click-cond-web', 'agent');
  assert.equal(dirDeConfigFora(path.join(agente, 'dist')), agente);
});

test('dirDeConfigFora(): qualquer outro diretório (fonte, cópia do harness) fica como está', () => {
  const fonte = path.join(path.sep, 'x', 'agent', 'src', 'core');
  const harness = path.join(path.sep, 'x', 'agent', 'harness', '.tmp-agent');
  assert.equal(dirDeConfigFora(fonte), fonte);
  assert.equal(dirDeConfigFora(harness), harness);
  // "distribuicao" não é "dist": só o nome exato sobe um nível.
  const parecido = path.join(path.sep, 'x', 'distribuicao');
  assert.equal(dirDeConfigFora(parecido), parecido);
});

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

// ---------- rename com EPERM/EBUSY/EACCES intermitente (Windows) ----------

function erroFs(code) {
  return Object.assign(new Error(`${code}: operation not permitted, rename`), { code });
}

for (const code of ['EPERM', 'EBUSY', 'EACCES']) {
  test(`gravarJsonAtomico(): ${code} no rename (antivírus/indexador segurando o arquivo) → tenta de novo e grava`, (t) => {
    const nome = `estado-teste-retry-${code}.json`;
    limpar(nome);
    try {
      const real = fs.renameSync;
      let chamadas = 0;
      t.mock.method(fs, 'renameSync', (...args) => {
        chamadas++;
        if (chamadas <= 2) throw erroFs(code);
        return real(...args);
      });
      gravarJsonAtomico(nome, { tentativa: 3 });
      assert.equal(chamadas, 3);
      t.mock.restoreAll();
      assert.deepEqual(lerJson(nome, null), { tentativa: 3 });
    } finally {
      t.mock.restoreAll();
      limpar(nome);
    }
  });
}

test('gravarJsonAtomico(): EPERM persistente → desiste após RENAME_TENTATIVAS e propaga o erro', (t) => {
  const nome = 'estado-teste-retry-esgotado.json';
  limpar(nome);
  try {
    const renomear = t.mock.method(fs, 'renameSync', () => {
      throw erroFs('EPERM');
    });
    assert.throws(() => gravarJsonAtomico(nome, { x: 1 }), { code: 'EPERM' });
    assert.equal(RENAME_TENTATIVAS, 5);
    assert.equal(renomear.mock.callCount(), RENAME_TENTATIVAS);
  } finally {
    t.mock.restoreAll();
    limpar(nome);
  }
});

test('gravarJsonAtomico(): outro erro no rename (ex.: ENOSPC) propaga na hora, sem nova tentativa', (t) => {
  const nome = 'estado-teste-retry-outro.json';
  limpar(nome);
  try {
    const renomear = t.mock.method(fs, 'renameSync', () => {
      throw erroFs('ENOSPC');
    });
    assert.throws(() => gravarJsonAtomico(nome, { x: 1 }), { code: 'ENOSPC' });
    assert.equal(renomear.mock.callCount(), 1);
  } finally {
    t.mock.restoreAll();
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
