/**
 * Apaga os dados de teste, preservando estrutura, Users e Planos.
 *
 * Modo padrão é DRY-RUN: lista o que seria apagado e não escreve nada.
 * Só apaga de verdade com --confirmo-apagar-tudo.
 *
 * Preserva Users porque apagar contas removeria o login do próprio operador.
 * Preserva Planos porque é tabela de catálogo, não dado de cliente.
 *
 * Uso:
 *   node --env-file=.env scripts/migration/wipe-test-data.mjs
 *   node --env-file=.env scripts/migration/wipe-test-data.mjs --confirmo-apagar-tudo
 */
import mysql from 'mysql2/promise';
import { contarTodasAsTabelas } from './dump-database.mjs';

const CONFIRMADO = process.argv.includes('--confirmo-apagar-tudo');

/** Tabelas que NÃO são apagadas. */
const PRESERVAR = new Set(['Users', 'Planos', '_prisma_migrations']);

function buildConfig() {
  const url = new URL(process.env.DATABASE_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
    connectTimeout: 20000,
  };
}

async function main() {
  const cfg = buildConfig();
  const conn = await mysql.createConnection(cfg);
  try {
    const antes = await contarTodasAsTabelas(conn, cfg.database);
    const alvo = Object.entries(antes)
      .map(([t, n]) => [t, Number(n)])
      .filter(([t, n]) => !PRESERVAR.has(t) && n > 0);
    const totalAlvo = alvo.reduce((a, [, n]) => a + n, 0);

    console.log(CONFIRMADO ? '=== APAGANDO ===' : '=== DRY-RUN (nada será apagado) ===');
    for (const [t, n] of alvo) console.log(`  ${t.padEnd(30)} ${String(n).padStart(8)} linhas`);
    console.log(`  ${'TOTAL'.padEnd(30)} ${String(totalAlvo).padStart(8)} linhas`);
    console.log('\nPreservadas:');
    for (const t of PRESERVAR) if (antes[t] !== undefined) console.log(`  ${t}: ${antes[t]} linhas`);

    if (!CONFIRMADO) {
      console.log('\nNada foi alterado. Para apagar de verdade, rode com --confirmo-apagar-tudo');
      return;
    }

    // FOREIGN_KEY_CHECKS=0 evita ter que descobrir a ordem topológica correta
    // das ~50 tabelas. Religado no finally, mesmo se algo falhar no meio.
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    try {
      for (const [t] of alvo) {
        await conn.query(`DELETE FROM \`${t}\``);
        await conn.query(`ALTER TABLE \`${t}\` AUTO_INCREMENT = 1`);
        console.log(`  apagada: ${t}`);
      }
    } finally {
      await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    }

    const depois = await contarTodasAsTabelas(conn, cfg.database);
    const restantes = Object.entries(depois)
      .map(([t, n]) => [t, Number(n)])
      .filter(([t, n]) => !PRESERVAR.has(t) && n > 0);
    if (restantes.length) {
      console.error('\nAINDA HÁ LINHAS:', restantes.map(([t, n]) => `${t}=${n}`).join(', '));
      throw new Error(`Linhas remanescentes após wipe: ${restantes.map(([t, n]) => `${t}=${n}`).join(', ')}`);
    }
    console.log(`\nOK. Users preservados: ${depois['Users'] ?? 0}`);
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error('Wipe falhou:', e.message);
  process.exit(1);
});
