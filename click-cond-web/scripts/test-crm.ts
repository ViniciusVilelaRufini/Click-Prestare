import { PrismaClient } from '../apps/api/src/app/prisma/generated';
import * as fs from 'fs';
import * as path from 'path';

// Carrega .env manualmente
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const prisma = new PrismaClient();

async function testQuery(name: string, fn: () => Promise<any>) {
  try {
    const start = Date.now();
    const res = await fn();
    console.log(`✅ [${name}] Sucesso: ${res} (${Date.now() - start}ms)`);
  } catch (err: any) {
    console.error(`❌ [${name}] Erro:`, err.message || err);
  }
}

async function main() {
  console.log('🔌 Conectando ao banco...');
  const condominios = await prisma.condominios.findMany({ select: { id: true, nome: true } });
  console.log(`Encontrados ${condominios.length} condomínios.`);

  if (condominios.length === 0) return;

  const cond = condominios[0];
  const idCond = cond.id;
  console.log(`\nTesting queries for: ${cond.nome} (ID: ${idCond})`);

  const agora = new Date();
  const inicioMes30 = new Date(agora.getTime() - 30 * 24 * 3600 * 1000);

  await testQuery('funcionarios_Portaria.count', () => 
    prisma.funcionarios_Portaria.count({ where: { id_condominio: idCond, ativo: 1 } })
  );

  await testQuery('funcionarios.count', () => 
    prisma.funcionarios.count({ where: { id_condominio: idCond } })
  );

  await testQuery('facial_Devices.count', () => 
    prisma.facial_Devices.count({ where: { id_condominio: idCond, ativo: 1 } })
  );

  await testQuery('facial_Devices.count (offline)', () => 
    prisma.facial_Devices.count({
      where: {
        id_condominio: idCond,
        ativo: 1,
        OR: [
          { ultima_sincr: null },
          { ultima_sincr: { lt: new Date(agora.getTime() - 10 * 60 * 1000) } }
        ]
      }
    })
  );

  await testQuery('moradores.count (with face)', () => 
    prisma.moradores.count({ where: { id_condominio: idCond, face_id: { not: null } } })
  );

  await testQuery('moradores.count (with tag)', () => 
    prisma.moradores.count({ where: { id_condominio: idCond, tag_rfid: { not: null } } })
  );

  await testQuery('encomendas.count (Aguardando)', () => 
    prisma.encomendas.count({ where: { id_condominio: idCond, status: 'Aguardando' } })
  );

  await testQuery('encomendas.count (30 days)', () => 
    prisma.encomendas.count({ where: { id_condominio: idCond, recebido_em: { gte: inicioMes30 } } })
  );

  await testQuery('comunicados.count', () => 
    prisma.comunicados.count({ where: { id_condominio: idCond, created_at: { gte: inicioMes30 } } })
  );

  await testQuery('areas_Sociais_Agendamentos.count', () => 
    prisma.areas_Sociais_Agendamentos.count({ where: { area: { id_condominio: idCond }, data: { gte: inicioMes30 } } })
  );

  await testQuery('prestadores_servico.count', () => 
    prisma.prestadores_servico.count({ where: { id_condominio: idCond } })
  );

  await testQuery('assembleias.count', () => 
    prisma.assembleias.count({ where: { id_condominio: idCond, data: { gte: agora } } })
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
