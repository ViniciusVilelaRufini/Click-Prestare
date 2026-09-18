require('dotenv').config();
const mysql = require('mysql2/promise');

async function addProvider() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'click_cond'
  });

  try {
    const [result] = await connection.execute(
      'INSERT INTO Prestadores_servico (nome, telefone, categorias, id_condominio, created_at) VALUES (?, ?, ?, ?, ?)',
      ['PRESTADOR VINDO DO APP', '11888888888', 'Limpeza', 1, new Date()]
    );
    console.log('Inserido com sucesso, ID:', result.insertId);
  } catch (err) {
    console.error(err);
  } finally {
    await connection.end();
  }
}

addProvider();
