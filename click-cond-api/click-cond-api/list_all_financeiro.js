require('dotenv').config();
const mysql = require('mysql2/promise');

async function listUnpaidCond6() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const [rows] = await connection.execute(
    'SELECT id, nome, valor, pago, status, data_vencimento FROM Financeiro WHERE id_condominio = 6 AND pago = 0'
  );
  console.log('Unpaid financeiro records for Condominio 6:');
  console.log(rows);
  await connection.end();
}

listUnpaidCond6().catch(console.error);
