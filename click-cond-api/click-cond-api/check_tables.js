require('dotenv').config();
const mysql = require('mysql2/promise');

async function checkTables() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const [rows] = await connection.execute('SHOW TABLES');
  console.log('Tables:');
  console.log(rows);
  await connection.end();
}

checkTables().catch(console.error);
