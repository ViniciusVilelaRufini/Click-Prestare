const { PrismaClient } = require('./apps/api/src/app/prisma/generated');
const prisma = new PrismaClient();

async function check() {
  try {
    const idCondominio = 7;
    console.log("=== COUNTS FOR CONDOMINIO 7 ===");
    
    const prestadoresCount = await prisma.prestadores_servico.count({
      where: { id_condominio: idCondominio }
    });
    console.log("Registered Prestadores (prestadores_servico):", prestadoresCount);
    
    const visitantesPrestadoresCount = await prisma.visitantes.count({
      where: { id_condominio: idCondominio, is_prestador: 1 }
    });
    console.log("Visitantes table with is_prestador = 1:", visitantesPrestadoresCount);
    
    const activeVisitantesPrestadoresCount = await prisma.visitantes.count({
      where: { id_condominio: idCondominio, is_prestador: 1, NOT: { data_entrada: null }, data_saida: null }
    });
    console.log("Active (currently on site) Prestadores from Visitantes:", activeVisitantesPrestadoresCount);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

check();
