/**
 * Cria um síndico de teste no banco de dados (AWS RDS).
 *
 * Uso: npx ts-node scripts/create-sindico.ts
 *      ou: npx tsx scripts/create-sindico.ts
 *
 * Le DATABASE_URL do .env.
 */
import { PrismaClient } from '../apps/api/src/app/prisma/generated';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as path from 'path';

// Carrega .env manualmente (script standalone, sem dotenv).
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const prisma = new PrismaClient();

async function main() {
  const NOME = 'Sindico Teste';
  const EMAIL = 'sindico.teste@clickprestarecondominios.com.br';
  const LOGIN = EMAIL;
  const SENHA = 'sindico123';
  const CPF = '12345678901';
  const TELEFONE = '11999990000';

  // Verifica se já existe
  const existente = await prisma.users.findFirst({
    where: { OR: [{ email: EMAIL }, { login: LOGIN }] },
    include: { sindicos: true },
  });

  if (existente) {
    console.log(`\n⚠️  Usuário já existe (id=${existente.id}). Atualizando senha...`);
    const newHash = await bcrypt.hash(SENHA, 10);
    await prisma.users.update({
      where: { id: existente.id },
      data: { password: newHash, is_sindico: 1, name: NOME, login: LOGIN },
    });
    if (!existente.sindicos || existente.sindicos.length === 0) {
      await prisma.sindicos.create({
        data: {
          name: NOME,
          email: EMAIL,
          phone: TELEFONE,
          doc_identification: CPF,
          id_user: existente.id,
        },
      });
      console.log('  Vinculo Sindicos criado.');
    }
    printCreds(existente.id);
    return;
  }

  console.log('\n🆕 Criando novo síndico...');
  const passwordHash = await bcrypt.hash(SENHA, 10);

  const user = await prisma.users.create({
    data: {
      name: NOME,
      email: EMAIL,
      login: LOGIN,
      password: passwordHash,
      phone: TELEFONE,
      cpf: CPF,
      is_sindico: 1,
      login_type: 'sindico',
    },
  });

  await prisma.sindicos.create({
    data: {
      name: NOME,
      email: EMAIL,
      phone: TELEFONE,
      doc_identification: CPF,
      id_user: user.id,
    },
  });

  printCreds(user.id);

  function printCreds(id: number) {
    console.log('\n✅ Síndico pronto para uso:');
    console.log('   ID........:', id);
    console.log('   Nome......:', NOME);
    console.log('   Login.....:', LOGIN);
    console.log('   Senha.....:', SENHA);
    console.log('\nUse no app mobile (/api/sindico/login) ou no painel web.\n');
  }
}

main()
  .catch((err) => {
    console.error('Erro:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
