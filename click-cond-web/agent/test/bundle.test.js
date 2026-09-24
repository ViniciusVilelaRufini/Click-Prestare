'use strict';

/**
 * Confere que o pipeline de build (esbuild) empacota o agente num único
 * arquivo CommonJS válido. Não roda o agente em si (isso é o harness) —
 * só garante que o bundle existe e não tem erro de sintaxe.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// require(esm) síncrono exige Node >=22.12; o agente suporta Node >=18, por
// isso usamos import() dinâmico (funciona desde o Node 12) em vez de require().

test('bundle() gera dist/click-agent.cjs e o arquivo é um script válido', async () => {
  const { bundle } = await import('../build-bundle.mjs');
  const outfile = bundle();

  assert.equal(outfile, path.join(__dirname, '..', 'dist', 'click-agent.cjs'));
  assert.ok(fs.existsSync(outfile), `bundle não foi gerado em ${outfile}`);
  assert.ok(fs.statSync(outfile).size > 0, 'bundle gerado está vazio');

  // node --check valida a sintaxe sem executar o arquivo.
  execFileSync(process.execPath, ['--check', outfile], { stdio: 'pipe' });
});
