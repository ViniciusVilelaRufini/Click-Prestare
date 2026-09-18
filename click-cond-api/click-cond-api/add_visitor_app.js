require('dotenv').config();
const mysql = require('mysql2/promise');

async function addVisitor() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'click_cond'
  });

  try {
    const [result] = await connection.execute(
      'INSERT INTO Visitantes (nome, doc_identificacao, id_apartamento, id_condominio, is_visitante, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ['VISITANTE VINDO DO APP', '999888777', 1, 1, 1, new Date()]
    );
    console.log('Inserido com sucesso, ID:', result.insertId);
  } catch (err) {
    console.error(err);
  } finally {
    await connection.end();
  }
}

addVisitor();
