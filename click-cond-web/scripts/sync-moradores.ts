import { PrismaClient } from '../apps/api/src/app/prisma/generated';

const prisma = new PrismaClient();

async function main() {
  console.log('Iniciando sincronização de Moradores -> Apartamentos_Users...');

  // Busca todos os moradores
  const moradores = await prisma.moradores.findMany({
    include: {
      user: true,
    },
  });

  console.log(`Encontrados ${moradores.length} moradores no total.`);

  let vinculadosCount = 0;
  let criadosAptoCount = 0;
  let atualizadosMoradorCount = 0;

  for (const morador of moradores) {
    if (!morador.id_user) {
      console.log(`Morador #${morador.id} (${morador.nome}) não possui id_user cadastrado. Pulando...`);
      continue;
    }

    const blocoStr = morador.bloco?.trim() || '';
    const aptoStr = morador.apartamento?.trim() || '';

    if (!blocoStr && !aptoStr) {
      console.log(`Morador #${morador.id} (${morador.nome}) não possui bloco/apartamento preenchidos. Pulando...`);
      continue;
    }

    // Tenta encontrar um apartamento que corresponda a bloco e apto no mesmo condomínio
    let apto = await prisma.apartamentos.findFirst({
      where: {
        id_condominio: morador.id_condominio ?? -1,
        bloco: blocoStr || null,
        apto: aptoStr || null,
      },
    });

    if (!apto) {
      // Se não existir, cria o apartamento para não perder o vínculo
      apto = await prisma.apartamentos.create({
        data: {
          id_condominio: morador.id_condominio ?? -1,
          bloco: blocoStr || null,
          apto: aptoStr || null,
        },
      });
      criadosAptoCount++;
      console.log(`Criado apartamento bloco "${blocoStr}", apto "${aptoStr}" para Condomínio #${morador.id_condominio}`);
    }

    // Verifica se já existe um vínculo em Apartamentos_Users
    const vinculoExistente = await prisma.apartamentos_Users.findFirst({
      where: {
        id_apto: apto.id,
        id_user: morador.id_user,
      },
    });

    if (!vinculoExistente) {
      const dataVenc = new Date();
      dataVenc.setDate(dataVenc.getDate() + 45);

      await prisma.apartamentos_Users.create({
        data: {
          id_apto: apto.id,
          id_user: morador.id_user,
          tipo: morador.tipo || 'proprietario',
          vencimento: dataVenc,
        },
      });
      vinculadosCount++;
      console.log(`Vinculado Morador #${morador.id} (${morador.nome}) ao apartamento ID ${apto.id}`);
    }
  }

  console.log(`Sincronização concluída!`);
  console.log(`- Novos apartamentos criados: ${criadosAptoCount}`);
  console.log(`- Moradores vinculados com sucesso: ${vinculadosCount}`);
}

main()
  .catch((e) => {
    console.error('Erro na sincronização:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
