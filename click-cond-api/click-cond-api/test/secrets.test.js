// Roda com: node --test test/secrets.test.js  (sem dependências)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const { resolveSecret } = require('../src/configs/secrets');

function envSem(...nomes) {
  const env = { ...process.env };
  for (const n of nomes) delete env[n];
  delete env.NODE_ENV;
  return env;
}

test('resolveSecret devolve o valor definido no ambiente', () => {
  assert.equal(resolveSecret('JWT_SECRET', { JWT_SECRET: 'segredo-de-verdade' }), 'segredo-de-verdade');
});

test('resolveSecret recusa segredo ausente ou em branco fora de teste', () => {
  assert.throws(() => resolveSecret('JWT_SECRET', {}), /JWT_SECRET não está definido/);
  assert.throws(() => resolveSecret('JWT_SECRET', { JWT_SECRET: '   ', NODE_ENV: 'production' }), /JWT_SECRET/);
  assert.throws(() => resolveSecret('SESSION_SECRET', { NODE_ENV: 'development' }), /SESSION_SECRET/);
});

test('em NODE_ENV=test usa um segredo só de teste', () => {
  assert.equal(resolveSecret('JWT_SECRET', { NODE_ENV: 'test' }), 'test-only-JWT_SECRET');
});

test('config.js não carrega sem JWT_SECRET (sem fallback público)', () => {
  const r = spawnSync(process.execPath, ['-e', "require('./src/configs/config.js')"], {
    cwd: ROOT,
    env: envSem('JWT_SECRET'),
    encoding: 'utf8',
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /JWT_SECRET não está definido/);
});

test('config.js usa o JWT_SECRET do ambiente', () => {
  const r = spawnSync(
    process.execPath,
    ['-e', "process.stdout.write(require('./src/configs/config.js').jwt.secretKey)"],
    { cwd: ROOT, env: { ...envSem('JWT_SECRET'), JWT_SECRET: 'abc123-def456' }, encoding: 'utf8' },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'abc123-def456');
});

test('nenhum segredo literal sobra em config.js e app.js', () => {
  const config = fs.readFileSync(path.join(ROOT, 'src/configs/config.js'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  assert.doesNotMatch(config, /fallback-secret/);
  assert.doesNotMatch(app, /dev-session-secret/);
  assert.match(app, /resolveSecret\('SESSION_SECRET'\)/);
});
