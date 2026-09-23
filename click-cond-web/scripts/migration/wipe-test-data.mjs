/**
 * Remove somente dados de teste de um banco explicitamente autorizado.
 *
 * Nunca execute em produção. Mesmo o DRY-RUN recusa produção e bancos fora
 * da allowlist. Para apagar, é obrigatório informar o banco, um dump recente
 * e criptografado, e a confirmação explícita.
 *
 * Uso:
 *   DATABASE_DUMP_KEY=<64-hex> node --env-file=.env scripts/migration/wipe-test-data.mjs
 *   DATABASE_DUMP_KEY=<64-hex> node --env-file=.env scripts/migration/wipe-test-data.mjs \
 *     --confirmo-apagar-tudo <nome-do-banco> --dump backups/dump-<stamp>.json.enc
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildConfig,
  contarTodasAsTabelas,
  resolveBackupDirectory,
  verifyDumpForWipe,
} from './dump-database.mjs';

const CONFIRMADO = process.argv.includes('--confirmo-apagar-tudo');

/** Bancos de teste criados e mantidos para esta finalidade; nunca inclua produção. */
export const WIPE_DATABASE_ALLOWLIST = new Set(['click_cond_test']);

/**
 * Tabelas que nunca podem ser apagadas pelo wipe. A lista é deliberadamente
 * curta, versionada e auditável: adicionar uma tabela exige revisão explícita.
 */
export const PRESERVED_TABLES = new Set([
  'Users',
  'crm_admins',
  'Planos',
  '_prisma_migrations',
  '_schema_migrations',
]);

const PRODUCTION_DATABASE_NAME = /(^|[_-])(prod|production|live)([_-]|$)/i;

/** Recusa produção e qualquer banco não listado explicitamente como ambiente de teste. */
export function assertWipeDatabaseAllowed(
  database,
  { nodeEnv = process.env.NODE_ENV, allowedDatabases = WIPE_DATABASE_ALLOWLIST } = {},
) {
  if (nodeEnv === 'production' || PRODUCTION_DATABASE_NAME.test(database)) {
    throw new Error('O wipe é proibido em produção.');
  }
  if (!allowedDatabases.has(database)) {
    throw new Error(`Banco "${database}" não está na allowlist explícita do wipe.`);
  }
}

export function shouldPreserveTable(table) {
  return PRESERVED_TABLES.has(table);
}

/** Tabelas cujo AUTO_INCREMENT não pode ser resetado para 1. */
const OFFSET_AUTO_INCREMENT = { pessoas: 2000000, visitas: 1000000 };
const NAO_RESETAR_AUTO_INCREMENT = new Set(Object.keys(OFFSET_AUTO_INCREMENT));

function bancoInformado() {
  const idx = process.argv.indexOf('--confirmo-apagar-tudo');
  return idx === -1 ? null : process.argv[idx + 1] ?? null;
}

function dumpInformado() {
  const idx = process.argv.indexOf('--dump');
  return idx === -1 ? null : process.argv[idx + 1] ?? null;
}

function readVerifiedDump(targetDatabase) {
  const informado = dumpInformado();
  if (!informado) {
    throw new Error('Informe um dump recente com --dump <arquivo.json.enc> antes de apagar.');
  }
  const backupDir = fs.realpathSync(resolveBackupDirectory());
  const dumpPath = fs.realpathSync(path.resolve(informado));
  const relative = path.relative(backupDir, dumpPath);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !dumpPath.endsWith('.json.enc')) {
    throw new Error('O dump precisa ser um arquivo .json.enc dentro do diretório de backups aprovado.');
  }
  let envelope;
  try {
    envelope = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));
  } catch {
    throw new Error('Não foi possível ler o dump criptografado informado.');
  }
  return verifyDumpForWipe(envelope, process.env.DATABASE_DUMP_KEY, targetDatabase);
}

async function main() {
  const cfg = buildConfig();
  assertWipeDatabaseAllowed(cfg.database);
  if (CONFIRMADO) {
    const nomeDigitado = bancoInformado();
    if (!nomeDigitado || nomeDigitado !== cfg.database) {
      throw new Error('Confirmação insuficiente: informe o nome exato do banco depois de --confirmo-apagar-tudo.');
    }
    readVerifiedDump(cfg.database);
  }

  const { default: mysql } = await import('mysql2/promise');
  const conn = await mysql.createConnection(cfg);
  try {
    const antes = await contarTodasAsTabelas(conn, cfg.database);
    const alvo = Object.entries(antes)
      .map(([t, n]) => [t, Number(n)])
      .filter(([t, n]) => !shouldPreserveTable(t) && n > 0);
    const totalAlvo = alvo.reduce((a, [, n]) => a + n, 0);

    console.log(CONFIRMADO ? '=== APAGANDO ===' : '=== DRY-RUN (nada será apagado) ===');
    for (const [t, n] of alvo) console.log(`  ${t.padEnd(30)} ${String(n).padStart(8)} linhas`);
    console.log(`  ${'TOTAL'.padEnd(30)} ${String(totalAlvo).padStart(8)} linhas`);
    console.log('\nTabelas preservadas:');
    for (const t of PRESERVED_TABLES) if (antes[t] !== undefined) console.log(`  ${t}: ${antes[t]} linhas`);

    if (!CONFIRMADO) return;

    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    try {
      for (const [t] of alvo) {
        await conn.query(`DELETE FROM \`${t}\``);
        await conn.query(
          NAO_RESETAR_AUTO_INCREMENT.has(t)
            ? `ALTER TABLE \`${t}\` AUTO_INCREMENT = ${OFFSET_AUTO_INCREMENT[t]}`
            : `ALTER TABLE \`${t}\` AUTO_INCREMENT = 1`,
        );
        console.log(`  apagada: ${t}`);
      }
    } finally {
      await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    }

    const depois = await contarTodasAsTabelas(conn, cfg.database);
    const restantes = Object.entries(depois)
      .map(([t, n]) => [t, Number(n)])
      .filter(([t, n]) => !shouldPreserveTable(t) && n > 0);
    if (restantes.length) {
      throw new Error(`Linhas remanescentes após wipe: ${restantes.map(([t, n]) => `${t}=${n}`).join(', ')}`);
    }
  } finally {
    await conn.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error('Wipe falhou:', e.message);
    process.exit(1);
  });
}
