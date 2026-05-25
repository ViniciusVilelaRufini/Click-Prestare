const { PrismaClient } = require('./apps/api/src/app/prisma/generated');
const prisma = new PrismaClient();

async function check() {
  try {
    const conds = await prisma.condominios.findMany();
    console.log("=== COUNTS ACROSS ALL CONDOMINIOS ===");
    for (const c of conds) {
      const pCount = await prisma.prestadores_servico.count({ where: { id_condominio: c.id } });
      const vPrestCount = await prisma.visitantes.count({ where: { id_condominio: c.id, is_prestador: 1 } });
      const vActivePrest = await prisma.visitantes.count({ where: { id_condominio: c.id, is_prestador: 1, NOT: { data_entrada: null }, data_saida: null } });
      console.log(`Condominio ${c.id} (${c.nome}):`);
      console.log(`  - Registered Prestadores (prestadores_servico): ${pCount}`);
      console.log(`  - Visitantes (is_prestador = 1): ${vPrestCount}`);
      console.log(`  - Active Prestadores (on site): ${vActivePrest}`);
    }
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

check();
