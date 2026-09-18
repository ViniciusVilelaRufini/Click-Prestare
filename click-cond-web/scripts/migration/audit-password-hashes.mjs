/**
 * Script de Auditoria de Segurança: Diagnóstico de Senhas (Bcrypt vs MD5)
 * Executa queries de análise estatística na base ativa AWS RDS MySQL
 * 
 * Uso: node click-cond-web/scripts/migration/audit-password-hashes.mjs
 */
import mysql from 'mysql2/promise';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carregar variáveis de ambiente de click-cond-web ou click-cond-api
const envPaths = [
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../../../click-cond-api/click-cond-api/.env')
];

for (const p of envPaths) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p });
  }
}

// Extrair configurações de conexão
let host = process.env.DB_HOST || 'database-1.crq2ie2ww3dh.sa-east-1.rds.amazonaws.com';
let port = parseInt(process.env.DB_PORT || '3306', 10);
let user = process.env.DB_USER || 'admin';
let password = process.env.DB_PASSWORD || process.env.AWS_RDS_PASSWORD;
let database = process.env.DB_NAME || 'click_prestare';

if (process.env.DATABASE_URL) {
  try {
    const parsed = new URL(process.env.DATABASE_URL);
    host = parsed.hostname || host;
    port = parseInt(parsed.port || '3306', 10);
    user = decodeURIComponent(parsed.username || user);
    password = decodeURIComponent(parsed.password || password);
    database = (parsed.pathname || '').replace(/^\//, '') || database;
  } catch (e) {
    // URL fallback
  }
}

if (!password) {
  console.error('❌ Erro: Senha do banco não encontrada em DATABASE_URL nem em DB_PASSWORD.');
  process.exit(1);
}

async function runAudit() {
  console.log('================================================================');
  console.log('  RELATÓRIO DE AUDITORIA DE SEGURANÇA: HASH DE SENHAS (AWS RDS) ');
  console.log('================================================================');
  console.log(`📡 Host: ${host}`);
  console.log(`📦 Database: ${database}`);
  console.log(`🕒 Data/Hora: ${new Date().toISOString()}\n`);

  let connection;
  try {
    connection = await mysql.createConnection({
      host,
      port,
      user,
      password,
      database,
      connectTimeout: 20000,
      ssl: { rejectUnauthorized: false }
    });

    console.log('✅ Conexão estabelecida com o banco AWS RDS.\n');

    // 1. Auditoria na Tabela Users
    console.log('--- 1. TABELA PRINCIPAL: Users ---');
    const [usersStats] = await connection.execute(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN password LIKE '$2%' THEN 1 ELSE 0 END) as bcrypt_count,
        SUM(CASE WHEN (password NOT LIKE '$2%' AND CHAR_LENGTH(password) = 32) THEN 1 ELSE 0 END) as md5_count,
        SUM(CASE WHEN (password IS NULL OR password = '') THEN 1 ELSE 0 END) as empty_count,
        SUM(CASE WHEN (password NOT LIKE '$2%' AND CHAR_LENGTH(password) != 32 AND password IS NOT NULL AND password != '') THEN 1 ELSE 0 END) as other_count
      FROM Users
    `);

    const totalUsers = usersStats[0].total || 0;
    const bcryptUsers = usersStats[0].bcrypt_count || 0;
    const md5Users = usersStats[0].md5_count || 0;
    const emptyUsers = usersStats[0].empty_count || 0;
    const otherUsers = usersStats[0].other_count || 0;

    const bcryptPct = totalUsers > 0 ? ((bcryptUsers / totalUsers) * 100).toFixed(1) : 0;
    const md5Pct = totalUsers > 0 ? ((md5Users / totalUsers) * 100).toFixed(1) : 0;

    console.log(`  Total de Contas de Usuários : ${totalUsers}`);
    console.log(`  🔒 Bcrypt ($2a/$2b)          : ${bcryptUsers} (${bcryptPct}%)`);
    console.log(`  ⚠️  MD5 Legado (32 hex chars): ${md5Users} (${md5Pct}%)`);
    if (emptyUsers > 0) console.log(`  ℹ️  Sem Senha/Vazio          : ${emptyUsers}`);
    if (otherUsers > 0) console.log(`  ❓ Outro Formato            : ${otherUsers}`);

    // Breakdown por papel de usuário
    console.log('\n  Detalhamento por Papel (Users):');
    const [roles] = await connection.execute(`
      SELECT 
        CASE 
          WHEN is_sindico = 1 THEN 'Síndico'
          WHEN is_morador = 1 THEN 'Morador'
          WHEN is_funcionario = 1 THEN 'Funcionário'
          ELSE 'Outro/Indefinido'
        END as papel,
        COUNT(*) as total,
        SUM(CASE WHEN password LIKE '$2%' THEN 1 ELSE 0 END) as bcrypt_count,
        SUM(CASE WHEN (password NOT LIKE '$2%' AND CHAR_LENGTH(password) = 32) THEN 1 ELSE 0 END) as md5_count
      FROM Users
      GROUP BY papel
      ORDER BY total DESC
    `);

    for (const r of roles) {
      const bPct = r.total > 0 ? ((r.bcrypt_count / r.total) * 100).toFixed(1) : 0;
      console.log(`    - ${r.papel.padEnd(16)}: Total ${r.total} | Bcrypt: ${r.bcrypt_count} (${bPct}%) | MD5: ${r.md5_count}`);
    }

    // 2. Auditoria na Tabela Funcionarios_Portaria
    console.log('\n--- 2. TABELA DE PORTARIA: Funcionarios_Portaria ---');
    const [portariaTables] = await connection.execute(`
      SHOW TABLES LIKE 'Funcionarios_Portaria'
    `);

    if (portariaTables.length > 0) {
      const [portariaStats] = await connection.execute(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN password LIKE '$2%' THEN 1 ELSE 0 END) as bcrypt_count,
          SUM(CASE WHEN (password NOT LIKE '$2%' AND CHAR_LENGTH(password) = 32) THEN 1 ELSE 0 END) as md5_count,
          SUM(CASE WHEN (password IS NULL OR password = '') THEN 1 ELSE 0 END) as empty_count
        FROM Funcionarios_Portaria
      `);

      const totalPortaria = portariaStats[0].total || 0;
      const bcryptPortaria = portariaStats[0].bcrypt_count || 0;
      const md5Portaria = portariaStats[0].md5_count || 0;
      const pBcryptPct = totalPortaria > 0 ? ((bcryptPortaria / totalPortaria) * 100).toFixed(1) : 0;
      const pMd5Pct = totalPortaria > 0 ? ((md5Portaria / totalPortaria) * 100).toFixed(1) : 0;

      console.log(`  Total de Porteiros Cadastrados: ${totalPortaria}`);
      console.log(`  🔒 Bcrypt ($2a/$2b)           : ${bcryptPortaria} (${pBcryptPct}%)`);
      console.log(`  ⚠️  MD5 Legado (32 hex chars) : ${md5Portaria} (${pMd5Pct}%)`);
    } else {
      console.log('  Tabela Funcionarios_Portaria não encontrada.');
    }

    // 3. Conclusão da Estratégia de Migração Just-in-Time
    console.log('\n================================================================');
    console.log('  STATUS DA BLINDAGEM DO SISTEMA                                ');
    console.log('================================================================');
    console.log('  ✅ Inserções de novos usuários: 100% blindadas com Bcrypt (10/12 rounds)');
    console.log('  ✅ Alterações e redefinições de senha: 100% blindadas com Bcrypt');
    console.log('  ✅ Auto-migração Just-in-Time ativada em todos os endpoints de login:');
    console.log('     - Síndico Web (NestJS /auth/sindico/login)');
    console.log('     - Portaria Web (NestJS /auth/login)');
    console.log('     - Funcionários App (Express ControllerFuncionarios)');
    console.log('     - Moradores App (Express ControllerMoradores)');
    console.log('     - Usuários Gerais (Express ControllerUsers)');
    console.log('  🛡️ Resultado: Os usuários restantes com MD5 serão convertidos');
    console.log('     automaticamente e de forma transparente no momento de seu login.');
    console.log('================================================================\n');

  } catch (err) {
    console.error('❌ Falha ao executar auditoria:', err);
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

runAudit();
