require('dotenv').config();
const mysql = require('mysql2/promise');

async function debugMane() {
  const config = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'click_cond'
  };

  const connection = await mysql.createConnection(config);

  try {
    console.log("--- DEBUG: BUSCANDO 'MANE' ---");
    
    // 1. Verificar na tabela Users
    const [users] = await connection.execute("SELECT id, login, is_funcionario FROM Users WHERE name LIKE '%mane%' OR login LIKE '%mane%'");
    console.log("Users encontrados:", users);

    // 2. Verificar na tabela Funcionarios
    const [funcs] = await connection.execute("SELECT id, nome, email, id_user, id_condominio FROM Funcionarios WHERE nome LIKE '%mane%'");
    console.log("Funcionários encontrados:", funcs);

    // 3. Verificar estrutura da tabela Funcionarios (para ver se falta algum campo obrigatório)
    const [columns] = await connection.execute("SHOW COLUMNS FROM Funcionarios");
    console.log("Estrutura da tabela Funcionarios:", columns.map(c => `${c.Field} (${c.Type}) ${c.Null === 'NO' ? 'REQUIRED' : ''}`));

  } catch (err) {
    console.error("Erro no debug:", err);
  } finally {
    await connection.end();
  }
}

debugMane();
