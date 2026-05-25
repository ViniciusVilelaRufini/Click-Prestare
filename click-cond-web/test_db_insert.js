const { PrismaClient } = require('./apps/api/src/app/prisma/generated');
const prisma = new PrismaClient();

async function test() {
  try {
    const data = {
      nome: "Test Null Data",
      tipo: "C",
      valor: 100,
      data: null,
      data_vencimento: new Date(),
      categoria: "Condomínio",
      id_condominio: 7,
      pago: 0
    };
    const created = await prisma.financeiro.create({ data });
    console.log("Created successfully with null data:", created);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

test();
