/**
 * Dump completo do banco para arquivo criptografado — SOMENTE LEITURA.
 *
 * O conteúdo do banco nunca é gravado em JSON legível. O wipe só aceita um
 * dump recente, autenticado e destinado ao mesmo banco alvo.
 *
 * Uso: DATABASE_DUMP_KEY=<64-hex> node --env-file=.env scripts/migration/dump-database.mjs
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DUMP_FORMAT = 'click-prestare/database-dump';
export const DUMP_MAX_AGE_MS = 30 * 60 * 1000;

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

export function resolveBackupDirectory() {
  return path.resolve(scriptDirectory, '..', '..', 'backups');
}

function dumpKey(key = process.env.DATABASE_DUMP_KEY) {
  if (!/^[0-9a-f]{64}$/i.test(key ?? '')) {
    throw new Error('DATABASE_DUMP_KEY deve conter exatamente 64 caracteres hexadecimais.');
  }
  return Buffer.from(key, 'hex');
}

function validateDumpPayload(payload) {
  if (!payload || typeof payload !== 'object' || !payload.contagens || !payload.dados) {
    throw new Error('Dump inválido: metadados ou dados ausentes.');
  }
  const tables = Object.keys(payload.contagens);
  if (tables.length !== Object.keys(payload.dados).length) {
    throw new Error('Dump inválido: conjunto de tabelas inconsistente.');
  }
  for (const table of tables) {
    const expected = Number(payload.contagens[table]);
    if (!Number.isSafeInteger(expected) || expected < 0 || !Array.isArray(payload.dados[table])) {
      throw new Error(`Dump inválido na tabela "${table}".`);
    }
    if (payload.dados[table].length !== expected) {
      throw new Error(`Dump incompleto na tabela "${table}".`);
    }
  }
}

export function createEncryptedDump(payload, key = process.env.DATABASE_DUMP_KEY) {
  validateDumpPayload(payload);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dumpKey(key), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return {
    format: DUMP_FORMAT,
    version: 1,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

function decryptDump(envelope, key) {
  if (
    !envelope ||
    envelope.format !== DUMP_FORMAT ||
    envelope.version !== 1 ||
    envelope.algorithm !== 'aes-256-gcm' ||
    !envelope.iv ||
    !envelope.authTag ||
    !envelope.ciphertext
  ) {
    throw new Error('Dump não possui um envelope criptografado verificável.');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', dumpKey(key), Buffer.from(envelope.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString('utf8'));
  } catch {
    throw new Error('Dump não pôde ser autenticado com DATABASE_DUMP_KEY.');
  }
}

export function verifyDumpForWipe(
  envelope,
  key,
  targetDatabase,
  now = new Date(),
  maxAgeMs = DUMP_MAX_AGE_MS,
) {
  const payload = decryptDump(envelope, key);
  validateDumpPayload(payload);
  const createdAt = new Date(payload.geradoEm);
  if (Number.isNaN(createdAt.valueOf()) || createdAt > now || now - createdAt > maxAgeMs) {
    throw new Error('Dump precisa ser recente e ter no máximo 30 minutos.');
  }
  if (payload.database !== targetDatabase) {
    throw new Error('Dump verificado pertence a outro banco alvo.');
  }
  return payload.contagens;
}

export function buildConfig() {
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
  // Falha antes de conectar ou ler qualquer linha se o segredo do dump não foi configurado.
  dumpKey();
  const cfg = buildConfig();
  const { default: mysql } = await import('mysql2/promise');
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
    const envelope = createEncryptedDump(
      { geradoEm: new Date().toISOString(), database: cfg.database, contagens, dados },
    );
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dir = resolveBackupDirectory();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const destino = path.join(dir, `dump-${stamp}.json.enc`);
    fs.writeFileSync(destino, JSON.stringify(envelope), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    console.log(`Dump criptografado salvo: ${destino}`);
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
