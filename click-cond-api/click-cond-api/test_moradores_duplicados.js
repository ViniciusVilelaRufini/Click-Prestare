require('dotenv').config();
const mysql = require('mysql2/promise');

async function testQuery() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  console.log("=== APARTAMENTOS ===");
  const [aptos] = await connection.execute("SELECT id, bloco, apto FROM Apartamentos WHERE apto = '22'");
  console.log(aptos);

  if (aptos.length > 0) {
    const aptoId = aptos[0].id;
    console.log(`\n=== APARTAMENTO_USERS PARA APTO ID ${aptoId} ===`);
    const [au] = await connection.execute("SELECT * FROM Apartamentos_Users WHERE id_apto = ?", [aptoId]);
    console.log(au);

    console.log(`\n=== MORADORES ===`);
    const [moradores] = await connection.execute("SELECT * FROM Moradores");
    console.log(moradores);

    console.log(`\n=== USERS ===`);
    const [users] = await connection.execute("SELECT id, login, name, is_morador FROM Users");
    console.log(users);

    console.log(`\n=== EXECUÇÃO DA QUERY ORIGINAL DE GET_MORADORES PARA APTO ID ${aptoId} ===`);
    const [results] = await connection.execute(`
      select u.id, u.photo, m.nome, m.documento, m.data_nascimento, m.email, m.telefone,  m.extra1, m.extra2, m.extra3, m.extra4 
      from Moradores m
      inner join Users u on m.id_user = u.id
      inner join Apartamentos_Users au on au.id_user = u.id
      where au.tipo='Proprietário' and au.id_apto=?
    `, [aptoId]);
    console.log(results);

    console.log(`\n=== EXECUÇÃO DA QUERY CORRIGIDA DE GET_MORADORES COM FILTRO DE CONDOMINIO PARA APTO ID ${aptoId} ===`);
    const [resultsCorrigida] = await connection.execute(`
      select u.id, u.photo, m.nome, m.documento, m.data_nascimento, m.email, m.telefone,  m.extra1, m.extra2, m.extra3, m.extra4 
      from Moradores m
      inner join Users u on m.id_user = u.id
      inner join Apartamentos_Users au on au.id_user = u.id
      inner join Apartamentos a on a.id = au.id_apto
      where au.tipo='Proprietário' and au.id_apto=? and m.id_condominio = a.id_condominio
    `, [aptoId]);
    console.log(resultsCorrigida);
  }

  await connection.end();
}

testQuery().catch(console.error);
