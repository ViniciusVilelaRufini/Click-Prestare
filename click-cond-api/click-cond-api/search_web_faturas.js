require('dotenv').config();
const mysql = require('mysql2/promise');

async function searchWebFaturas() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const [byName] = await connection.execute(
    "SELECT id, id_condominio, nome, valor, pago, status, data_vencimento FROM Financeiro WHERE nome LIKE '%05/2026%'"
  );
  console.log('Financeiro records matching "%05/2026%":');
  console.log(byName);

  const [byVal] = await connection.execute(
    "SELECT id, id_condominio, nome, valor, pago, status, data_vencimento FROM Financeiro WHERE valor = 650.00"
  );
  console.log('Financeiro records with valor = 650.00:');
  console.log(byVal);

  await connection.end();
}

searchWebFaturas().catch(console.error);
