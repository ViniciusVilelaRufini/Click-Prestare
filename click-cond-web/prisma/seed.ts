/**
 * Seed inicial — popula o banco de dados (AWS RDS) com dados mínimos pra a Portaria Web operar.
 * Rodar com: npx tsx prisma/seed.ts
 *
 * Idempotente: pode rodar várias vezes que não duplica.
 */
import { PrismaClient } from '../apps/api/src/app/prisma/generated';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed...');

  // 1) Condomínio demo
  let condominio = await prisma.condominios.findFirst({
    where: { nome: 'Edifício Demo' },
  });
  if (!condominio) {
    condominio = await prisma.condominios.create({
      data: {
        nome: 'Edifício Demo',
        identificacao: 'DEMO-001',
        num_blocos: 2,
        num_aptos: 6,
        ativo: 1,
      },
    });
    console.log(`✓ Condomínio criado (id=${condominio.id})`);
  } else {
    console.log(`↺ Condomínio já existe (id=${condominio.id})`);
  }

  // 2) Apartamentos
  const aptos = [
    { bloco: 'A', apto: '101', fracao: '0.025' },
    { bloco: 'A', apto: '102', fracao: '0.025' },
    { bloco: 'A', apto: '305', fracao: '0.040' },
    { bloco: 'A', apto: '501', fracao: '0.025' },
    { bloco: 'B', apto: '202', fracao: '0.030' },
    { bloco: 'B', apto: '401', fracao: '0.030' },
  ];
  for (const a of aptos) {
    const exists = await prisma.apartamentos.findFirst({
      where: {
        id_condominio: condominio.id,
        bloco: a.bloco,
        apto: a.apto,
      },
    });
    if (!exists) {
      await prisma.apartamentos.create({
        data: { ...a, id_condominio: condominio.id },
      });
      console.log(`✓ Apto ${a.bloco}/${a.apto} criado`);
    }
  }

  // 3) Categorias de ocorrência
  const categorias = [
    { nome: 'Barulho', prioridade: 1 },
    { nome: 'Vandalismo', prioridade: 1 },
    { nome: 'Manutenção', prioridade: 2 },
    { nome: 'Segurança', prioridade: 1 },
    { nome: 'Outros', prioridade: 9 },
  ];
  for (const c of categorias) {
    const exists = await prisma.ocorrencias_Categorias.findFirst({
      where: { nome: c.nome },
    });
    if (!exists) {
      await prisma.ocorrencias_Categorias.create({ data: c });
      console.log(`✓ Categoria "${c.nome}" criada`);
    }
  }

  // 4) Porteiro padrão (pra você logar)
  const loginPorteiro = 'porteiro';
  const senhaPadrao = '123456';
  const porteiro = await prisma.funcionarios_Portaria.findFirst({
    where: { login: loginPorteiro },
  });
  if (!porteiro) {
    await prisma.funcionarios_Portaria.create({
      data: {
        nome: 'Porteiro Demo',
        login: loginPorteiro,
        password: bcrypt.hashSync(senhaPadrao, 10),
        turno: 'Diurno',
        id_condominio: condominio.id,
        ativo: 1,
      },
    });
    console.log(`✓ Porteiro padrão criado: login="${loginPorteiro}" senha="${senhaPadrao}"`);
  } else {
    console.log(`↺ Porteiro já existe: ${porteiro.login}`);
  }

  // 5) Comunicado de boas-vindas
  const comExists = await prisma.comunicados.findFirst({
    where: { titulo: 'Bem-vindo ao Click Portaria', id_condominio: condominio.id },
  });
  if (!comExists) {
    await prisma.comunicados.create({
      data: {
        titulo: 'Bem-vindo ao Click Portaria',
        descricao: 'Sistema operacional iniciado. Em caso de dúvidas, contate o síndico.',
        id_condominio: condominio.id,
      },
    });
    console.log('✓ Comunicado de boas-vindas criado');
  }

  console.log('🌱 Seed concluído.');
}

main()
  .catch((e) => {
    console.error('❌ Seed falhou:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
