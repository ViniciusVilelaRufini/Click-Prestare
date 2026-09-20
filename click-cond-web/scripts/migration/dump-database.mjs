/**
 * Dump completo do banco para arquivo JSON — SOMENTE LEITURA.
 *
 * Pré-requisito de segurança do wipe (wipe-test-data.mjs). Não recria
 * estrutura: a estrutura vive em prisma/schema.prisma e em prisma/sql/.
 * Este arquivo existe para poder devolver os DADOS se algo der errado.
 *
 * Uso: node --env-file=.env scripts/migration/dump-database.mjs
 */
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

function buildConfig() {
  const url = new URL(process.env.DATABASE_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
    connectTimeout: 20000,
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true,
  };
}

/** Conta linhas de cada tabela. Usado aqui e pelo wipe, para comparar antes/depois. */
export async function contarTodasAsTabelas(conn, database) {
  const [tabelas] = await conn.query(
    'SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ? AND table_type = "BASE TABLE" ORDER BY table_name',
    [database],
  );
  const contagens = {};
  for (const { t } of tabelas) {
    const [[row]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
    contagens[t] = row.n;
  }
  return contagens;
}

async function main() {
  const cfg = buildConfig();
  const conn = await mysql.createConnection(cfg);
  try {
    const contagens = await contarTodasAsTabelas(conn, cfg.database);
    const total = Object.values(contagens).reduce((a, b) => a + Number(b), 0);
    console.log(`Tabelas: ${Object.keys(contagens).length} | linhas totais: ${total}`);

    const dados = {};
    for (const tabela of Object.keys(contagens)) {
      const [rows] = await conn.query(`SELECT * FROM \`${tabela}\``);
      dados[tabela] = rows;
    }

    // Trava de completude: garante que cada tabela dumpou exatamente o
    // número de linhas contado antes. Sem isso, uma tabela vazia por engano
    // passaria despercebida num arquivo grande e aparentemente saudável.
    for (const tabela of Object.keys(contagens)) {
      const esperado = Number(contagens[tabela]);
      const obtido = dados[tabela].length;
      if (obtido !== esperado) {
        console.error(
          `Dump incompleto na tabela "${tabela}": esperado ${esperado} linha(s), obtido ${obtido}.`,
        );
        process.exit(1);
      }
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dir = path.resolve(process.cwd(), '..', 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const destino = path.join(dir, `dump-${stamp}.json`);
    fs.writeFileSync(destino, JSON.stringify({ geradoEm: new Date().toISOString(), contagens, dados }, null, 2));

    const bytes = fs.statSync(destino).size;
    console.log(`Dump salvo: ${destino} (${(bytes / 1024 / 1024).toFixed(2)} MB)`);

    // Trava de sanidade: dump vazio com banco cheio significa falha silenciosa.
    if (total > 0 && bytes < 1024) {
      console.error('Dump suspeito: banco tem linhas mas o arquivo saiu vazio.');
      process.exit(1);
    }
  } finally {
    await conn.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error('Dump falhou:', e.message);
    process.exit(1);
  });
}
