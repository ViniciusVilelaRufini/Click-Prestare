// Roda com: cd click-cond-web && node --test scripts/test/sem-senha-literal.test.mjs
//
// Os scripts que criam/resetam contas rodam contra o banco do .env (o RDS de
// produção). Senha literal neles vira credencial conhecida por quem leu o
// repositório. A senha vem de SCRIPT_PASSWORD.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '../../..');

const PADROES = [
  // const SENHA = 'x' / const pass = "x" / password: 'x' (literal de 4+ chars)
  /\b(password|senha|SENHA|[a-zA-Z]*[pP]ass)[A-Za-z_]*\s*[:=]\s*['"][^'"$]{4,}['"]/,
  // bcrypt.hash('literal', ...) / bcrypt.hashSync('literal', ...)
  /bcrypt\.hash(?:Sync)?\(\s*['"]/,
  // as senhas que já vazaram, em qualquer forma (inclusive em console.log)
  /['"](?:123456|999888|sindico123|clickpassword123)['"]/,
  // senha impressa no terminal: console.log(`... ${senha} ...`)
  /console\.\w+\(.*\$\{\s*[A-Za-z_]*(?:[sS]enha|SENHA|[pP]ass)[A-Za-z_]*\s*\}/,
];

function arquivosAlvo() {
  const saida = execFileSync(
    'git',
    [
      'ls-files',
      '--',
      'click-cond-web/scripts',
      'click-cond-api/click-cond-api',
      // seed/stress test gravam no banco do .env (o RDS)
      'click-cond-web/prisma',
      // scripts avulsos soltos na raiz de src/app (ex.: create_sindico.js)
      'click-cond-web/apps/api/src/app',
    ],
    { cwd: REPO, encoding: 'utf8' },
  );
  return saida
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((f) => /\.(ts|js|mjs)$/.test(f))
    .filter((f) => !f.startsWith('click-cond-web/scripts/test/'))
    .filter(
      (f) =>
        f.startsWith('click-cond-web/scripts/') ||
        f.startsWith('click-cond-web/prisma/') ||
        // Na API legada só os scripts soltos da raiz (src/ é o servidor).
        (f.startsWith('click-cond-api/') && f.split('/').length === 3) ||
        // Na API Nest só os arquivos soltos de src/app; os módulos (subpastas) ficam de fora.
        (f.startsWith('click-cond-web/apps/') && f.split('/').length === 6),
    );
}

test('nenhum script versionado traz senha literal', () => {
  const achados = [];
  for (const rel of arquivosAlvo()) {
    const linhas = fs.readFileSync(path.join(REPO, rel), 'utf8').split(/\r?\n/);
    linhas.forEach((linha, i) => {
      if (linha.includes('process.env')) return;
      if (PADROES.some((re) => re.test(linha))) achados.push(`${rel}:${i + 1}: ${linha.trim()}`);
    });
  }
  assert.deepEqual(achados, []);
});

test('a guarda cobre seed, stress test e os scripts soltos da API', () => {
  const alvos = arquivosAlvo();
  for (const f of [
    'click-cond-web/prisma/seed.ts',
    'click-cond-web/prisma/stress_test.ts',
    'click-cond-web/apps/api/src/app/create_sindico.js',
    'click-cond-web/scripts/create-sindico.ts',
  ]) {
    assert.ok(alvos.includes(f), `fora da guarda: ${f}`);
  }
});
