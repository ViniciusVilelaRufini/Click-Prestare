require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

async function fixUser() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  const email = 'morador@teste.com';
  const newPass = '123456';
  const hash = await bcrypt.hash(newPass, 10);

  console.log(`Reseting password for ${email} to ${newPass}...`);

  // Atualizando a senha para bcrypt e garantindo que is_morador = 1
  await connection.execute(`
    UPDATE Users 
    SET password = ? , is_morador = 1
    WHERE login = ? OR email = ?
  `, [hash, email, email]);

  // Verificando se o morador existe e está vinculado a um condomínio
  const [moradores] = await connection.execute(`
    SELECT m.id, m.id_user, m.id_condominio, u.login
    FROM Moradores m
    INNER JOIN Users u ON u.id = m.id_user
    WHERE u.login = ?
  `, [email]);

  if (moradores.length === 0) {
    console.log("User not found in Moradores table. Creating relationship...");
    // Se não existir na tabela Moradores, vamos inserir um vínculo básico
    const [userRows] = await connection.execute('SELECT id FROM Users WHERE login = ?', [email]);
    if (userRows.length > 0) {
        const userId = userRows[0].id;
        await connection.execute(`
            INSERT INTO Moradores (nome, email, id_user, id_condominio)
            VALUES (?, ?, ?, (SELECT id FROM Condominios LIMIT 1))
        `, ['Morador Teste', email, userId]);
    }
  } else {
    const morador = moradores[0];
    if (!morador.id_condominio) {
        console.log("User has no id_condominio. Assigning first available...");
        await connection.execute(`
            UPDATE Moradores SET id_condominio = (SELECT id FROM Condominios LIMIT 1)
            WHERE id = ?
        `, [morador.id]);
    }
  }

  console.log("User fixed successfully!");
  await connection.end();
}

fixUser().catch(console.error);
