const { PrismaClient } = require('./apps/api/src/app/prisma/generated');
const prisma = new PrismaClient();

async function run() {
  try {
    const user = await prisma.users.findUnique({
      where: { id: 190 },
      include: {
        moradores: true
      }
    });
    console.log("User 190 details:", JSON.stringify(user, null, 2));

    const financeiroList = await prisma.financeiro.findMany({
      where: {
        nome: {
          contains: "Apto 901"
        }
      },
      orderBy: { id: 'desc' }
    });
    console.log("Financeiro records matching Apto 901:", JSON.stringify(financeiroList, null, 2));
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

run();
