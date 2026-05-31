require('dotenv').config();
const mysql = require('mysql2/promise');

async function searchDebts() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const [rows] = await connection.execute(
    "SELECT id, id_condominio, nome, valor, pago, status, data_vencimento FROM Financeiro WHERE pago = 0"
  );
  
  const aptoDebts = rows.filter(r => {
    // Check if name has a 3-digit number (like 101, 102, etc.) or "apto" or "ap" or "bloco"
    const name = (r.nome || '').toUpperCase();
    return /\b\d{3}\b/.test(name) || name.includes('APTO') || name.includes('AP.') || name.includes('BLOCO');
  });

  console.log('Unpaid financeiro records resembling apartments:');
  console.log(aptoDebts);
  await connection.end();
}

searchDebts().catch(console.error);
