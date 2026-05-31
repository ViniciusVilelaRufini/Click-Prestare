require('dotenv').config();
const mysql = require('mysql2/promise');

async function check() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const [conds] = await connection.execute('SELECT id, nome FROM Condominios');
  console.log('Condominios:');
  console.log(conds);

  for (const c of conds) {
    const [aptos] = await connection.execute('SELECT id, bloco, apto FROM Apartamentos WHERE id_condominio = ?', [c.id]);
    console.log(`Condominio ${c.id} - ${c.nome} has ${aptos.length} apartments.`);
    if (aptos.length > 0) {
      console.log('Apartments:', aptos.slice(0, 10));
    }
  }

  await connection.end();
}

check().catch(console.error);
