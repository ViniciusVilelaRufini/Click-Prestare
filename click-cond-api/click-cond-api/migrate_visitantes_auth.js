/**
 * Migração idempotente — Portaria remota (autorização em tempo real).
 * Adiciona colunas auth_* em Visitantes + índice, checando information_schema
 * antes (MySQL 8 não suporta ADD COLUMN IF NOT EXISTS).
 *
 * Rodar: node migrate_visitantes_auth.js
 */
require('dotenv').config();
const db = require('./src/database/MySQL.js');

const COLUNAS = [
  { nome: 'auth_status', ddl: 'VARCHAR(20) NULL' },
  { nome: 'auth_solicitado_em', ddl: 'DATETIME NULL' },
  { nome: 'auth_respondido_em', ddl: 'DATETIME NULL' },
  { nome: 'auth_respondido_por', ddl: 'INT NULL' },
];

async function colunaExiste(nome) {
  const { results } = await db.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Visitantes' AND COLUMN_NAME = '${nome}'`,
  );
  return results[0].c > 0;
}

async function indiceExiste(nome) {
  const { results } = await db.query(
    `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Visitantes' AND INDEX_NAME = '${nome}'`,
  );
  return results[0].c > 0;
}

(async () => {
  try {
    for (const col of COLUNAS) {
      if (await colunaExiste(col.nome)) {
        console.log(`↺ Coluna ${col.nome} já existe.`);
      } else {
        await db.query(`ALTER TABLE Visitantes ADD COLUMN ${col.nome} ${col.ddl}`);
        console.log(`✓ Coluna ${col.nome} adicionada.`);
      }
    }
    if (await indiceExiste('idx_vis_auth_status')) {
      console.log('↺ Índice idx_vis_auth_status já existe.');
    } else {
      await db.query('CREATE INDEX idx_vis_auth_status ON Visitantes (auth_status)');
      console.log('✓ Índice idx_vis_auth_status criado.');
    }
    console.log('✅ Migração concluída.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Falha na migração:', err.message);
    process.exit(1);
  }
})();
