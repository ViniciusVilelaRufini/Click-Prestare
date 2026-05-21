require('dotenv').config();
const mysql = require('mysql2/promise');

async function migrate() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  console.log("Executando migração...");
  
  // 1. Verificar se a coluna já existe
  const [columns] = await connection.execute(`
    SELECT COLUMN_NAME 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'Visitantes' AND COLUMN_NAME = 'codigo_acesso'
  `, [process.env.DB_NAME]);

  if (columns.length === 0) {
    console.log("Adicionando coluna codigo_acesso...");
    await connection.execute(`
      ALTER TABLE Visitantes 
      ADD COLUMN codigo_acesso VARCHAR(10) NULL
    `);
    
    console.log("Criando índice para codigo_acesso...");
    await connection.execute(`
      CREATE INDEX idx_visitantes_codigo ON Visitantes (codigo_acesso)
    `);
    console.log("Migração concluída com sucesso!");
  } else {
    console.log("A coluna codigo_acesso já existe. Ignorando migração.");
  }

  await connection.end();
}

migrate().catch(console.error);
