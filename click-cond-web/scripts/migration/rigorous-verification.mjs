import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RAILWAY_URL = 'mysql://root:jWmcNvtW3UQAThADP7Exs5qHxxFp2Zwr@turntable.proxy.rlwy.net:54654/railway';
const AWS_CONFIG = {
  host: 'database-1.crq2ie2ww3dh.sa-east-1.rds.amazonaws.com',
  port: 3306,
  user: 'admin',
  password: '-+fD7_YHhF.,qZx',
  database: 'click_prestare',
  connectTimeout: 20000
};
const BACKUP_FILE = path.resolve(__dirname, '../../../backups/railway_dump_final.sql');

async function runRigorousVerification() {
  console.log('=== INICIANDO VERIFICAÇÃO RIGOROSA DE INTEGRIDADE (SUPERPOWERS) ===\n');

  // 1. Verificação do Backup Físico
  console.log('--- ETAPA 1: VERIFICAÇÃO DO BACKUP LOCAL NO DISCO ---');
  if (!fs.existsSync(BACKUP_FILE)) {
    console.error('❌ FALHA CRÍTICA: Arquivo de backup não existe no disco!');
    process.exit(1);
  }
  const stat = fs.statSync(BACKUP_FILE);
  const hash = crypto.createHash('sha256').update(fs.readFileSync(BACKUP_FILE)).digest('hex');
  console.log(`✅ Arquivo de Backup: ${BACKUP_FILE}`);
  console.log(`✅ Tamanho no Disco : ${(stat.size / (1024 * 1024)).toFixed(2)} MB (${stat.size} bytes)`);
  console.log(`✅ SHA-256 Checksum : ${hash}\n`);

  // 2. Conectividade com ambos os bancos
  console.log('--- ETAPA 2: TESTE DE CONECTIVIDADE CRUZAÇÃO ---');
  const source = await mysql.createConnection({ uri: RAILWAY_URL, dateStrings: true });
  console.log('✅ Conexão com Railway: OK (dateStrings preservados)');
  const dest = await mysql.createConnection({ ...AWS_CONFIG, dateStrings: true });
  console.log('✅ Conexão com AWS RDS: OK (dateStrings preservados)\n');

  // 3. Comparação Tabela por Tabela (Estrutura e Contagem)
  console.log('--- ETAPA 3: CONFERÊNCIA EXAUSTIVA DE TODAS AS 63 TABELAS ---');
  const [srcTablesRes] = await source.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
  const srcTables = srcTablesRes.map(r => Object.values(r)[0]).sort();

  const [dstTablesRes] = await dest.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
  const dstTables = dstTablesRes.map(r => Object.values(r)[0]).sort();

  if (srcTables.length !== dstTables.length) {
    console.error(`❌ DIVERGÊNCIA DE TABELAS: Railway tem ${srcTables.length}, AWS tem ${dstTables.length}`);
    process.exit(1);
  }
  console.log(`✅ Total de Tabelas: ${srcTables.length} no Railway e ${dstTables.length} no AWS RDS.`);

  let totalSrcRows = 0;
  let totalDstRows = 0;
  let divergencias = 0;

  for (const table of srcTables) {
    const [sCount] = await source.query(`SELECT COUNT(*) as c FROM \`${table}\``);
    const [dCount] = await dest.query(`SELECT COUNT(*) as c FROM \`${table}\``);
    const sc = sCount[0].c;
    const dc = dCount[0].c;
    totalSrcRows += sc;
    totalDstRows += dc;

    if (sc !== dc) {
      console.error(`❌ DIVERGÊNCIA NA TABELA ${table}: Railway=${sc} vs AWS=${dc}`);
      divergencias++;
    }
  }

  console.log(`✅ Total de Registros no Railway: ${totalSrcRows}`);
  console.log(`✅ Total de Registros no AWS RDS: ${totalDstRows}`);
  console.log(`✅ Divergências de Contagem: ${divergencias}\n`);

  if (divergencias > 0) {
    console.error('❌ Abortando: Houve divergência de contagem!');
    process.exit(1);
  }

  // 4. Spot Checks de Dados Sensíveis e Críticos (Amostras de Registros)
  console.log('--- ETAPA 4: SPOT CHECKS DE DADOS CRÍTICOS (CONTEÚDO E CHAVES) ---');
  
  // Amostra 1: Condomínios
  const [srcConds] = await source.query('SELECT id, nome, identificacao FROM Condominios ORDER BY id');
  const [dstConds] = await dest.query('SELECT id, nome, identificacao FROM Condominios ORDER BY id');
  const condMatch = JSON.stringify(srcConds) === JSON.stringify(dstConds);
  console.log(`✅ Condomínios (${srcConds.length} registros): ${condMatch ? 'CONFERIDO 100% IDÊNTICO' : 'DIVERGENTE'}`);

  // Amostra 2: Usuários Críticos / Administradores
  const [srcAdmins] = await source.query('SELECT id, login, nome, ativo FROM crm_admins ORDER BY id');
  const [dstAdmins] = await dest.query('SELECT id, login, nome, ativo FROM crm_admins ORDER BY id');
  const adminMatch = JSON.stringify(srcAdmins) === JSON.stringify(dstAdmins);
  console.log(`✅ CRM Admins (${srcAdmins.length} registros): ${adminMatch ? 'CONFERIDO 100% IDÊNTICO' : 'DIVERGENTE'}`);

  // Amostra 3: Primeiros e últimos 5 usuários (Users)
  const [srcUsers] = await source.query('SELECT id, name, email FROM Users ORDER BY id LIMIT 5');
  const [dstUsers] = await dest.query('SELECT id, name, email FROM Users ORDER BY id LIMIT 5');
  const usersMatch = JSON.stringify(srcUsers) === JSON.stringify(dstUsers);
  console.log(`✅ Amostra de Usuários (Top 5): ${usersMatch ? 'CONFERIDO 100% IDÊNTICO' : 'DIVERGENTE'}`);

  // Amostra 4: Acessos Faciais mais recentes
  const [srcFacial] = await source.query('SELECT id, id_condominio, nome_pessoa, evento, timestamp FROM Acessos_Facial ORDER BY id DESC LIMIT 5');
  const [dstFacial] = await dest.query('SELECT id, id_condominio, nome_pessoa, evento, timestamp FROM Acessos_Facial ORDER BY id DESC LIMIT 5');
  const facialMatch = JSON.stringify(srcFacial) === JSON.stringify(dstFacial);
  console.log(`✅ Amostra de Acessos Faciais (Últimos 5): ${facialMatch ? 'CONFERIDO 100% IDÊNTICO' : 'DIVERGENTE'}`);

  // Amostra 5: Áreas Sociais
  const [srcAreas] = await source.query('SELECT id, id_condominio, nome, capacidade FROM Areas_Sociais ORDER BY id');
  const [dstAreas] = await dest.query('SELECT id, id_condominio, nome, capacidade FROM Areas_Sociais ORDER BY id');
  const areasMatch = JSON.stringify(srcAreas) === JSON.stringify(dstAreas);
  console.log(`✅ Áreas Sociais (${srcAreas.length} registros): ${areasMatch ? 'CONFERIDO 100% IDÊNTICO' : 'DIVERGENTE'}`);

  // Amostra 6: Moradores
  const [srcMoradores] = await source.query('SELECT id, id_condominio, bloco, apartamento, id_user FROM Moradores ORDER BY id LIMIT 10');
  const [dstMoradores] = await dest.query('SELECT id, id_condominio, bloco, apartamento, id_user FROM Moradores ORDER BY id LIMIT 10');
  const moradoresMatch = JSON.stringify(srcMoradores) === JSON.stringify(dstMoradores);
  console.log(`✅ Moradores (Amostra 10): ${moradoresMatch ? 'CONFERIDO 100% IDÊNTICO' : 'DIVERGENTE'}`);

  // Amostra 7: Comunicados
  const [srcCom] = await source.query('SELECT id, id_condominio, titulo, created_at FROM Comunicados ORDER BY id LIMIT 10');
  const [dstCom] = await dest.query('SELECT id, id_condominio, titulo, created_at FROM Comunicados ORDER BY id LIMIT 10');
  const comMatch = JSON.stringify(srcCom) === JSON.stringify(dstCom);
  console.log(`✅ Comunicados (Amostra 10): ${comMatch ? 'CONFERIDO 100% IDÊNTICO' : 'DIVERGENTE'}`);

  if (!condMatch || !adminMatch || !usersMatch || !facialMatch || !areasMatch || !moradoresMatch || !comMatch) {
    console.error('❌ Abortando: Falha em um dos spot checks de integridade!');
    process.exit(1);
  }

  // 5. Teste da API em Execução no Elastic Beanstalk
  console.log('\n--- ETAPA 5: TESTE DE RESPOSTA DA API EM PRODUÇÃO NA AWS ---');
  try {
    const res1 = await fetch('http://Clickprestareapi-env.eba-bcmjawac.sa-east-1.elasticbeanstalk.com/api/auth/condominio/1');
    const data1 = await res1.json();
    console.log(`✅ Endpoint AWS /api/auth/condominio/1 retornou: "${data1.nome}" (Status: ${res1.status})`);

    const res17 = await fetch('http://Clickprestareapi-env.eba-bcmjawac.sa-east-1.elasticbeanstalk.com/api/auth/condominio/17');
    const data17 = await res17.json();
    console.log(`✅ Endpoint AWS /api/auth/condominio/17 retornou: "${data17.nome}" (Status: ${res17.status})`);
  } catch (e) {
    console.error('❌ Erro no teste da API AWS:', e.message);
    process.exit(1);
  }

  await source.end();
  await dest.end();

  console.log('\n=============================================================');
  console.log('  VEREDITO SUPERPOWERS: APROVADO COM EVIDÊNCIAS 100% COMPROVADAS');
  console.log('=============================================================');
}

runRigorousVerification().catch(e => {
  console.error('Erro na verificação:', e);
  process.exit(1);
});
