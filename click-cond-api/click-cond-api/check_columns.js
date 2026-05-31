require('dotenv').config();
const mysql = require('mysql2/promise');

async function checkColumns() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const [rows] = await connection.execute('DESCRIBE Financeiro');
  console.log('Financeiro columns:');
  console.log(rows);
  await connection.end();
}

checkColumns().catch(console.error);
