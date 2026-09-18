require('dotenv').config();
const mysql = require('mysql2/promise');

async function upgradeFinanceiroTable() {
  const config = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'click_cond'
  };

  const connection = await mysql.createConnection(config);

  try {
    console.log("--- UPGRADING FINANCEIRO TABLE (SECURE MODE) ---");

    const [columns] = await connection.execute("SHOW COLUMNS FROM Financeiro");
    const columnNames = columns.map(c => c.Field.toLowerCase());

    const addColumn = async (name, definition) => {
      if (!columnNames.includes(name.toLowerCase())) {
        console.log(`Adding column: ${name}`);
        await connection.execute(`ALTER TABLE Financeiro ADD COLUMN ${name} ${definition}`);
      } else {
        console.log(`Column ${name} already exists.`);
      }
    };

    await addColumn('categoria', "VARCHAR(100) DEFAULT 'Condomínio'");
    await addColumn('url_boleto', "TEXT");
    await addColumn('url_comprovante', "TEXT");
    await addColumn('data_vencimento', "DATE");
    await addColumn('status', "INT DEFAULT 0 COMMENT '0: Pendente, 1: Pago, 2: Em Verificação'");
    await addColumn('id_usuario', "INT COMMENT 'Referência ao morador específico'");

    console.log("\n✅ Banco de dados atualizado com sucesso!");

  } catch (err) {
    console.error("Erro no upgrade do banco:", err);
  } finally {
    await connection.end();
  }
}

upgradeFinanceiroTable();
