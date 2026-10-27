require('dotenv').config();
const mysql = require('mysql2/promise');

async function debugLogin() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  const email = 'teste@click.com';
  const pass = process.env.SCRIPT_PASSWORD || '';
  if (!pass) throw new Error('Defina SCRIPT_PASSWORD com a senha a testar.');

  console.log(`Debugging login for ${email}...`);

  // Verificando o usuário na tabela Users
  const [userRows] = await connection.execute('SELECT id, login, password, is_morador FROM Users WHERE login = ?', [email]);
  console.log("User in DB:", userRows);

  // Verificando o morador na tabela Moradores
  const [moradorRows] = await connection.execute('SELECT id, id_user, nome FROM Moradores WHERE id_user = ?', [userRows[0]?.id]);
  console.log("Morador in DB:", moradorRows);

  // Verificando o resultado do MD5 no próprio MySQL
  const [md5Rows] = await connection.execute('SELECT MD5(?) as my_md5', [pass]);
  console.log('MySQL MD5(SCRIPT_PASSWORD):', md5Rows[0].my_md5);

  // Testando a query EXATA do backend
  const query = `select u.id, s.nome, u.photo                           
                    from Moradores s 
                    inner join Users u on u.id = s.id_user
                    where u.login='${email}' and u.password=MD5('${pass}')`;
  console.log("Running backend query...");
  const [loginRows] = await connection.execute(query);
  console.log("Login Query Result:", loginRows);

  await connection.end();
}

debugLogin().catch(console.error);
