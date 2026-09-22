import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';

const allowed = new Set([
  '2026-09-11-consentimentos.sql',
  '2026-09-11-convites-visita.sql',
  '2026-09-16-consentimentos-terceiros.sql',
  '2026-09-20-integridade-acessos-facial.sql',
  '2026-09-20-pessoas-visitas.sql',
  '2026-09-21-offsets-pessoas-visitas.sql',
]);

const file = process.env.MIGRATION_FILE;
const databaseUrl = process.env.DATABASE_URL;
if (!file || !allowed.has(file)) throw new Error('MIGRATION_FILE is not an allowed SQL file');
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const sqlPath = path.resolve('prisma', 'sql', file);
const sql = await readFile(sqlPath, 'utf8');
const checksum = createHash('sha256').update(sql).digest('hex');
const caBundle = process.env.RDS_CA_BUNDLE
  ? await readFile(path.resolve(process.env.RDS_CA_BUNDLE))
  : undefined;
const url = new URL(databaseUrl);
const connection = await mysql.createConnection({
  host: url.hostname,
  port: Number(url.port || 3306),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.replace(/^\//, ''),
  ssl: { rejectUnauthorized: true, ...(caBundle ? { ca: caBundle } : {}) },
  multipleStatements: true,
});

try {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS _schema_migrations (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);
  const [rows] = await connection.query(
    'SELECT checksum FROM _schema_migrations WHERE filename = ?',
    [file],
  );
  if (rows.length) {
    if (rows[0].checksum !== checksum) throw new Error(`Checksum changed for already applied migration: ${file}`);
    console.log(`Already applied: ${file}`);
    process.exit(0);
  }

  console.log(`Applying ${file} (${checksum})`);
  const statements = sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) {
    try {
      await connection.query(statement);
    } catch (error) {
      const idempotentCodes = new Set([
        'ER_TABLE_EXISTS_ERROR',
        'ER_DUP_FIELDNAME',
        'ER_DUP_KEYNAME',
        'ER_CANT_DROP_FIELD_OR_KEY',
        'ER_FK_DUP_NAME',
      ]);
      if (!idempotentCodes.has(error.code)) throw error;
      console.log(`Already present, continuing: ${error.code}`);
    }
  }
  await connection.query(
    'INSERT INTO _schema_migrations (filename, checksum) VALUES (?, ?)',
    [file, checksum],
  );
  console.log(`Applied: ${file}`);
} finally {
  await connection.end();
}
