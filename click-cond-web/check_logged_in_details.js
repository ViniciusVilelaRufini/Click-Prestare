const { PrismaClient } = require('./apps/api/src/app/prisma/generated');
const prisma = new PrismaClient();

async function check() {
  try {
    const user = await prisma.users.findUnique({
      where: { id: 190 },
      include: { moradores: true }
    });
    console.log("=== User and Morador Details ===");
    console.log(JSON.stringify(user, null, 2));
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

check();
