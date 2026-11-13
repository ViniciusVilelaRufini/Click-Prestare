const { PrismaClient } = require('./prisma/generated');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function main() {
  const login = 'sindico_novo@click.com';
  // Senha nunca literal (o script grava no banco do .env). Ex.: SCRIPT_PASSWORD='...' node create_sindico.js
  const passwordRaw = process.env.SCRIPT_PASSWORD || '';
  if (passwordRaw.length < 12) {
    throw new Error('Defina SCRIPT_PASSWORD (mínimo 12 caracteres) com a senha da conta.');
  }
  const bcryptPassword = await bcrypt.hash(passwordRaw, 12);
  const name = 'Sindico de Teste 2026';
  const idCondominio = 1; // Edifício Demo

  console.log(`Criando usuário: ${login}...`);

  // 1. Criar o Usuário
  const user = await prisma.users.create({
    data: {
      login: login,
      password: bcryptPassword,
      is_sindico: 1,
      name: name,
    }
  });

  // 2. Criar o Perfil de Síndico
  await prisma.sindicos.create({
    data: {
      id_user: user.id,
      name: name,
      email: login,
      phone: '11999990000',
    }
  });

  // 3. Vincular ao Condomínio
  await prisma.sindicos_Condominios.create({
    data: {
      id_user: user.id,
      id_condominio: idCondominio,
    }
  });

  console.log(`✅ Usuário criado com sucesso!`);
  console.log(`Login: ${login}`);
  console.log('Senha: (a definida em SCRIPT_PASSWORD)');
}

main()
  .catch(e => {
    console.error('Erro ao criar usuário:', e.message || e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
