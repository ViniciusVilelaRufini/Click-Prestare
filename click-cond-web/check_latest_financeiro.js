const { PrismaClient } = require('./apps/api/src/app/prisma/generated');
const prisma = new PrismaClient();

async function check() {
  try {
    const list = await prisma.financeiro.findMany({
      orderBy: { created_at: 'desc' },
      take: 5
    });
    console.log("=== Latest 5 financeiro entries ===");
    console.log(JSON.stringify(list, null, 2));
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

check();
