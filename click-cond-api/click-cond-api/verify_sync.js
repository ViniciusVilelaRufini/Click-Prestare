require('dotenv').config();
const mysql = require('mysql2/promise');

async function checkSync() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'click_cond'
  });

  try {
    const [visitors] = await connection.execute('SELECT * FROM Visitantes WHERE nome LIKE ?', ['%TESTE SINCRONIZACAO%']);
    console.log(JSON.stringify(visitors, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await connection.end();
  }
}

checkSync();
