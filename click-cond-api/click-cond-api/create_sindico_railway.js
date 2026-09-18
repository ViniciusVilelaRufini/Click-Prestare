require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

async function createSindicoRailway() {
  const config = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'click_cond'
  };

  const connection = await mysql.createConnection(config);

  const email = 'sindico@click.com';
  const pass = 'sindico123';
  const hash = await bcrypt.hash(pass, 10);

  try {
    console.log("Creating Sindico user on AWS RDS...");
    
    // 1. Pegar o ID do condomínio
    const [condos] = await connection.execute('SELECT id FROM Condominios LIMIT 1');
    const condoId = condos[0].id;

    // 2. Criar Usuário
    await connection.execute('DELETE FROM Users WHERE login = ?', [email]);
    const [userResult] = await connection.execute(`
      INSERT INTO Users (login, email, password, is_sindico, name)
      VALUES (?, ?, ?, 1, 'Sindico Prestare')
    `, [email, email, hash]);
    const userId = userResult.insertId;

    // 3. Vincular na tabela de Sindicos (se existir) e Sindicos_Condominios
    console.log("Linking Sindico to Condominio...");
    
    // Tentar inserir em Sindicos primeiro (algumas estruturas exigem)
    try {
        await connection.execute(`INSERT INTO Sindicos (name, email, id_user) VALUES (?, ?, ?)`, ['Sindico Prestare', email, userId]);
    } catch(e) { console.log("Sindicos table error:", e.message); }

    // Vincular ao condomínio para ter acesso aos dados
    await connection.execute(`
      INSERT INTO Sindicos_Condominios (id_user, id_condominio)
      VALUES (?, ?)
    `, [userId, condoId]);

    console.log("\nSUCCESS! Sindico 'sindico@click.com' / 'sindico123' is ready on AWS RDS.");

  } catch (err) {
    console.error("Error creating Sindico:", err);
  } finally {
    await connection.end();
  }
}

createSindicoRailway();
