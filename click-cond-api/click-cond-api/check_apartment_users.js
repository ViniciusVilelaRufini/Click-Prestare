require('dotenv').config();
const mysql = require('mysql2/promise');

async function checkApartmentUsers() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  // 1. Get all apartments in Condominio 1
  const [aptos] = await connection.execute(
    'SELECT id, bloco, apto FROM Apartamentos WHERE id_condominio = 1'
  );
  console.log(`Found ${aptos.length} apartments in Condominio 1.`);

  // 2. Get all mappings in Apartamentos_Users
  const [aptosUsers] = await connection.execute(
    'SELECT * FROM Apartamentos_Users'
  );
  console.log(`Found ${aptosUsers.length} records in Apartamentos_Users.`);

  // 3. Get all residents in Moradores
  const [moradores] = await connection.execute(
    'SELECT id, id_user, id_condominio, apartamento, bloco FROM Moradores WHERE id_condominio = 1'
  );
  console.log(`Found ${moradores.length} records in Moradores for Condominio 1:`);
  console.log(moradores);

  // 4. Get all unpaid financeiro records for Condominio 1
  const [financeiro] = await connection.execute(
    'SELECT id, nome, id_usuario, pago, valor FROM Financeiro WHERE id_condominio = 1 AND pago = 0'
  );
  console.log('Unpaid financeiro records for Condominio 1:');
  console.log(financeiro);

  await connection.end();
}

checkApartmentUsers().catch(console.error);
