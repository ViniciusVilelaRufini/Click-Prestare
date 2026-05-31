require('dotenv').config();
const mysql = require('mysql2/promise');

async function checkUsers() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const [rows] = await connection.execute(
    'SELECT * FROM Users LIMIT 2'
  );
  console.log('Users sample:');
  console.log(rows);
  await connection.end();
}

checkUsers().catch(console.error);
