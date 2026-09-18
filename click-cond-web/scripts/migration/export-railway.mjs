import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RAILWAY_URL = process.env.DATABASE_URL || 'mysql://root:jWmcNvtW3UQAThADP7Exs5qHxxFp2Zwr@turntable.proxy.rlwy.net:54654/railway';
const OUTPUT_DIR = path.resolve(__dirname, '../../../backups');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'railway_dump_final.sql');

async function exportRailway() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log('Conectando ao banco de dados do Railway...');
  const conn = await mysql.createConnection(RAILWAY_URL);
  console.log('Conectado com sucesso ao Railway!');

  const [tablesResult] = await conn.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
  const tables = tablesResult.map(row => Object.values(row)[0]);
  console.log(`Encontradas ${tables.length} tabelas para extração.`);

  const writeStream = fs.createWriteStream(OUTPUT_FILE, { encoding: 'utf8' });

  writeStream.write('-- Exportação completa do Banco de Dados Railway\n');
  writeStream.write(`-- Data: ${new Date().toISOString()}\n`);
  writeStream.write('SET NAMES utf8mb4;\n');
  writeStream.write('SET FOREIGN_KEY_CHECKS = 0;\n');
  writeStream.write('SET UNIQUE_CHECKS = 0;\n');
  writeStream.write('SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";\n\n');

  const stats = {};

  for (const table of tables) {
    console.log(`Extraindo tabela: ${table}...`);
    
    // DDL
    const [createResult] = await conn.query(`SHOW CREATE TABLE \`${table}\``);
    const createSql = createResult[0]['Create Table'];
    writeStream.write(`DROP TABLE IF EXISTS \`${table}\`;\n`);
    writeStream.write(`${createSql};\n\n`);

    // Data
    const [countResult] = await conn.query(`SELECT COUNT(*) as total FROM \`${table}\``);
    const totalRows = countResult[0].total;
    stats[table] = totalRows;

    if (totalRows > 0) {
      writeStream.write(`-- Dados para tabela \`${table}\` (${totalRows} registros)\n`);
      const CHUNK_SIZE = 500;
      for (let offset = 0; offset < totalRows; offset += CHUNK_SIZE) {
        const [rows] = await conn.query(`SELECT * FROM \`${table}\` LIMIT ${CHUNK_SIZE} OFFSET ${offset}`);
        if (rows.length === 0) continue;

        const columns = Object.keys(rows[0]).map(c => `\`${c}\``).join(', ');
        const valuesList = rows.map(row => {
          return '(' + Object.values(row).map(val => {
            if (val === null || val === undefined) return 'NULL';
            if (typeof val === 'number') return val;
            if (typeof val === 'boolean') return val ? 1 : 0;
            if (val instanceof Date) {
              return mysql.escape(val.toISOString().slice(0, 19).replace('T', ' '));
            }
            if (Buffer.isBuffer(val)) {
              return `X'${val.toString('hex')}'`;
            }
            if (typeof val === 'object') {
              return mysql.escape(JSON.stringify(val));
            }
            return mysql.escape(val);
          }).join(', ') + ')';
        }).join(',\n');

        writeStream.write(`INSERT INTO \`${table}\` (${columns}) VALUES\n${valuesList};\n`);
      }
      writeStream.write('\n');
    }
  }

  writeStream.write('SET FOREIGN_KEY_CHECKS = 1;\n');
  writeStream.write('SET UNIQUE_CHECKS = 1;\n');
  writeStream.end();

  await conn.end();
  console.log(`\nDump concluído com sucesso! Arquivo salvo em: ${OUTPUT_FILE}`);
  console.log('\n--- RESUMO DE REGISTROS EXTRAÍDOS ---');
  for (const [tbl, count] of Object.entries(stats)) {
    if (count > 0) {
      console.log(`- ${tbl}: ${count} registros`);
    }
  }

  const jsonSummaryPath = path.join(OUTPUT_DIR, 'railway_stats.json');
  fs.writeFileSync(jsonSummaryPath, JSON.stringify(stats, null, 2));
  console.log(`Resumo estatístico salvo em: ${jsonSummaryPath}`);
}

exportRailway().catch(err => {
  console.error('Erro na extração do Railway:', err);
  process.exit(1);
});
