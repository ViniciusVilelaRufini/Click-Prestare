import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assetVaiNoPacote } from './assets-do-pacote.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('credenciais e .json ficam fora do pacote do Elastic Beanstalk', () => {
  for (const p of [
    'firebase-service-account.json',
    'sub/qualquer.json',
    'chave-service-account.txt',
    '.env',
    'sub/.env.local',
    'cert.pem',
    'id.key',
    'loja.p12',
    'x.pfx',
  ]) {
    assert.equal(assetVaiNoPacote(p), false, p);
  }
});

test('a pasta raiz e os simuladores HTML continuam indo', () => {
  for (const p of ['', 'simulator.html', 'simulador-acesso.html', 'simulator-qr.html', 'simulator-rfid.html']) {
    assert.equal(assetVaiNoPacote(p), true, p);
  }
});

test('bundle-eb.mjs copia os assets com o filtro', () => {
  const fonte = fs.readFileSync(path.join(__dirname, 'bundle-eb.mjs'), 'utf8');
  assert.match(fonte, /filter:\s*\(origem\)\s*=>\s*assetVaiNoPacote\(path\.relative\(assetsSrc, origem\)\)/);
});

test('webpack não copia .json nem service-account para dist/assets', () => {
  const fonte = fs.readFileSync(path.join(__dirname, '../../apps/api/webpack.config.js'), 'utf8');
  assert.ok(fonte.includes("ignore: ['**/*.json', '**/*service-account*', '**/.env*']"));
  assert.ok(!fonte.includes("assets: ['./src/assets']"));
});
