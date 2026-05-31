require('dotenv').config();
const mysql = require('mysql2/promise');

async function search() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const [rows] = await connection.execute(
    "SELECT id, id_condominio, nome, valor, pago, status, data_vencimento FROM Financeiro WHERE nome LIKE '%102%'"
  );
  console.log('Financeiro records containing 102 in name:');
  console.log(rows);
  await connection.end();
}

search().catch(console.error);
