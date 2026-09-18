import mysql from 'mysql2/promise';

const RAILWAY_URL = process.env.DATABASE_URL_RAILWAY || process.env.DATABASE_URL;
const AWS_URL = process.env.DATABASE_URL_AWS || process.env.DATABASE_URL;

async function sync() {
  console.log('--- INICIANDO MIGRAÇÃO DIRETA: RAILWAY → AWS RDS ---');
  
  console.log('1. Conectando na Origem (Railway)...');
  const source = await mysql.createConnection(RAILWAY_URL);
  console.log('   Origem conectada com sucesso!');

  console.log('2. Conectando no Destino (AWS RDS)...');
  const dest = await mysql.createConnection(AWS_CONFIG);
  console.log('   Destino conectado com sucesso!');

  console.log('3. Desativando checagens de chave estrangeira no destino...');
  await dest.query('SET NAMES utf8mb4;');
  await dest.query('SET FOREIGN_KEY_CHECKS = 0;');
  await dest.query('SET UNIQUE_CHECKS = 0;');
  await dest.query('SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";');

  const [tablesResult] = await source.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
  const tables = tablesResult.map(row => Object.values(row)[0]);
  console.log(`\nTotal de tabelas a migrar: ${tables.length}\n`);

  const results = [];

  for (let i = 0; i < tables.length; i++) {
    const table = tables[i];
    const prefix = `[${i + 1}/${tables.length}] ${table.padEnd(28)}`;

    // 1. DDL: Criação da Tabela
    const [createResult] = await source.query(`SHOW CREATE TABLE \`${table}\``);
    const createSql = createResult[0]['Create Table'];
    await dest.query(`DROP TABLE IF EXISTS \`${table}\`;`);
    await dest.query(createSql);

    // 2. Contagem na Origem
    const [countRes] = await source.query(`SELECT COUNT(*) as total FROM \`${table}\``);
    const sourceTotal = countRes[0].total;

    if (sourceTotal === 0) {
      console.log(`${prefix} : 0 registros (estrutura recriada)`);
      results.push({ table, sourceTotal, destTotal: 0, status: 'OK (vazia)' });
      continue;
    }

    // 3. Cópia em Lotes
    const BATCH_SIZE = 500;
    let inserted = 0;

    for (let offset = 0; offset < sourceTotal; offset += BATCH_SIZE) {
      const [rows] = await source.query(`SELECT * FROM \`${table}\` LIMIT ${BATCH_SIZE} OFFSET ${offset}`);
      if (rows.length === 0) break;

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

      const insertSql = `INSERT INTO \`${table}\` (${columns}) VALUES\n${valuesList};`;
      const [res] = await dest.query(insertSql);
      inserted += res.affectedRows;
    }

    // 4. Verificação no Destino
    const [destCountRes] = await dest.query(`SELECT COUNT(*) as total FROM \`${table}\``);
    const destTotal = destCountRes[0].total;

    if (sourceTotal === destTotal) {
      console.log(`${prefix} : ${destTotal} / ${sourceTotal} registros migrados [OK]`);
      results.push({ table, sourceTotal, destTotal, status: 'OK' });
    } else {
      console.error(`${prefix} : ERRO! Origem=${sourceTotal}, Destino=${destTotal}`);
      results.push({ table, sourceTotal, destTotal, status: 'DIVERGÊNCIA' });
    }
  }

  console.log('\n4. Reativando checagens de chave estrangeira no destino...');
  await dest.query('SET FOREIGN_KEY_CHECKS = 1;');
  await dest.query('SET UNIQUE_CHECKS = 1;');

  await source.end();
  await dest.end();

  console.log('\n=============================================');
  console.log('       RELATÓRIO FINAL DE MIGRAÇÃO');
  console.log('=============================================');
  
  let totalOrigem = 0;
  let totalDestino = 0;
  let falhas = 0;

  for (const r of results) {
    totalOrigem += r.sourceTotal;
    totalDestino += r.destTotal;
    if (r.status === 'DIVERGÊNCIA') falhas++;
  }

  console.log(`Total de Tabelas Migradas : ${tables.length}`);
  console.log(`Total de Registros Origem  : ${totalOrigem}`);
  console.log(`Total de Registros Destino : ${totalDestino}`);
  console.log(`Divergências               : ${falhas}`);

  if (falhas === 0 && totalOrigem === totalDestino) {
    console.log('\n🎉 SUCESSO TOTAL: 100% DOS DADOS FORAM TRANSFERIDOS PARA O AWS RDS!');
  } else {
    console.error('\n⚠️ ATENÇÃO: Houve falhas em algumas tabelas.');
    process.exit(1);
  }
}

sync().catch(err => {
  console.error('\nErro fatal durante a migração:', err);
  process.exit(1);
});
