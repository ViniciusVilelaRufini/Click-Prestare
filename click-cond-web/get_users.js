const { PrismaClient } = require('./apps/api/src/app/prisma/generated');
const prisma = new PrismaClient();

async function run() {
  try {
    const users = await prisma.users.findMany({
      take: 10,
    });
    console.log("Users:", users);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

run();
