import { PrismaService } from './apps/api/src/app/prisma/prisma.service';

const prisma = new PrismaService();

async function main() {
  await prisma.$connect();
  const user = await prisma.users.findUnique({
    where: { id: 47 }
  });
  console.log('USER 47:', JSON.stringify(user, null, 2));

  const moradores = await prisma.moradores.findMany({
    where: { id_user: 47 },
    include: { condominio: true }
  });
  console.log('MORADORES:', JSON.stringify(moradores, null, 2));

  const au = await prisma.apartamentos_Users.findMany({
    where: { id_user: 47 },
    include: {
      apartamento: {
        include: { condominio: true }
      }
    }
  });
  console.log('APARTAMENTOS USERS:', JSON.stringify(au, null, 2));

  const faturas = await prisma.financeiro.findMany({
    where: {
      OR: [
        { id_usuario: 47 },
        { nome: { contains: 'Apto 22' } }
      ]
    }
  });
  console.log('FATURAS RELATED:', JSON.stringify(faturas, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
