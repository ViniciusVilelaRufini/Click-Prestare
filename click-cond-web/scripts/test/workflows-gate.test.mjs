// Roda com: cd click-cond-web && node --test scripts/test/workflows-gate.test.mjs
//
// Regra: todo job de workflow que usa `secrets.` precisa (1) do environment
// `production` e (2) de um `if` que o prenda a refs/heads/master ou main.
// Sem isso, um workflow_dispatch de qualquer branch chegava em produção com
// as credenciais da AWS / da Apple.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

const here = path.dirname(fileURLToPath(import.meta.url));
const WF_DIR = path.resolve(here, '../../../.github/workflows');
const REF_PROTEGIDA = /github\.ref\s*==\s*'refs\/heads\/(master|main)'/;

function workflows() {
  return fs
    .readdirSync(WF_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => ({ arquivo: f, wf: yaml.load(fs.readFileSync(path.join(WF_DIR, f), 'utf8')) }));
}

function nomeDoEnvironment(job) {
  if (!job.environment) return null;
  return typeof job.environment === 'string' ? job.environment : job.environment.name;
}

test('todo job que usa segredo está no environment production e preso a master/main', () => {
  const violacoes = [];
  for (const { arquivo, wf } of workflows()) {
    for (const [id, job] of Object.entries(wf.jobs ?? {})) {
      if (!JSON.stringify(job).includes('secrets.')) continue;
      if (nomeDoEnvironment(job) !== 'production') violacoes.push(`${arquivo}:${id} sem environment production`);
      if (!REF_PROTEGIDA.test(String(job.if ?? ''))) violacoes.push(`${arquivo}:${id} sem if de ref protegida`);
    }
  }
  assert.deepEqual(violacoes, []);
});

test('ci.yml: o job api (que roda em PR) não tem credencial nenhuma', () => {
  const ci = workflows().find((w) => w.arquivo === 'ci.yml').wf;
  assert.equal(JSON.stringify(ci.jobs.api).includes('secrets.'), false);
  assert.ok(ci.jobs.deploy, 'job deploy existe');
  assert.deepEqual([].concat(ci.jobs.deploy.needs), ['api']);
});

test('database-migration.yml só roda a partir do master', () => {
  const mig = workflows().find((w) => w.arquivo === 'database-migration.yml').wf;
  assert.match(String(mig.jobs.migrate.if ?? ''), /github\.ref\s*==\s*'refs\/heads\/master'/);
});

test('ci.yml: o deploy confere a versão que ficou no ambiente (falha silenciosa do EB)', () => {
  const ci = workflows().find((w) => w.arquivo === 'ci.yml').wf;
  const passos = ci.jobs.deploy.steps ?? [];
  const iDeploy = passos.findIndex((s) => String(s.uses ?? '').startsWith('einaregilsson/beanstalk-deploy'));
  const iVerifica = passos.findIndex((s) => s.name === 'Verify deployed version');
  assert.ok(iDeploy >= 0, 'passo de deploy existe');
  assert.ok(iVerifica > iDeploy, 'Verify deployed version vem depois do deploy');
  const run = String(passos[iVerifica].run ?? '');
  assert.match(run, /Environments\[0\]\.VersionLabel/);
  assert.match(run, /exit 1/);
  // Confere a MESMA versão que o passo de deploy publica.
  assert.match(String(ci.jobs.deploy.env?.VERSION_LABEL ?? ''), /github\.sha/);
  assert.equal(passos[iDeploy].with?.version_label, '${{ env.VERSION_LABEL }}');
  assert.match(run, /\$VERSION_LABEL/);
  // O aws CLI do passo precisa de credencial: configure-aws-credentials antes dele.
  const iCred = passos.findIndex((s) => String(s.uses ?? '').startsWith('aws-actions/configure-aws-credentials'));
  assert.ok(iCred >= 0 && iCred < iVerifica, 'credenciais AWS configuradas antes da verificação');
});
