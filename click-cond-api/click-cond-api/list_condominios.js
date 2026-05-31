require('dotenv').config();
const mysql = require('mysql2/promise');

async function listCondominios() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const [rows] = await connection.execute(
    'SELECT id, nome FROM Condominios'
  );
  console.log('Condominios:');
  console.log(rows);
  await connection.end();
}

listCondominios().catch(console.error);
