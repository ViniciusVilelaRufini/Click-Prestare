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
    const [providers] = await connection.execute('SELECT * FROM Prestadores_servico WHERE nome LIKE ?', ['%PRESTADOR TESTE WEB%']);
    console.log(JSON.stringify(providers, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await connection.end();
  }
}

checkSync();
