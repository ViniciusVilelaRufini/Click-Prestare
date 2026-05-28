import { PrismaClient } from './apps/api/src/app/prisma/generated';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  try {
    console.log("Conectando ao banco de dados...");
    
    // 1. Verificar condominios
    let condominio = await prisma.condominios.findFirst();
    if (!condominio) {
      console.log("Nenhum condomínio encontrado. Criando 'Condomínio Central'...");
      condominio = await prisma.condominios.create({
        data: {
          nome: "Condomínio Central",
          identificacao: "Central",
          num_blocos: 2,
          num_aptos: 40,
          moeda: "BRL",
          ativo: 1,
        }
      });
      console.log(`Condomínio criado com ID: ${condominio.id}`);
    } else {
      console.log(`Usando condomínio existente: "${condominio.nome}" (ID: ${condominio.id})`);
    }

    // 2. Dados do síndico
    const email = "sindico@click.com";
    const login = "sindico";
    const name = "Síndico Click";
    const senhaPlana = "clickpassword123";

    // Verificar se já existe um usuário com este e-mail ou login
    const usuarioExistente = await prisma.users.findFirst({
      where: {
        OR: [
          { email: email },
          { login: login }
        ]
      }
    });

    if (usuarioExistente) {
      console.log(`Usuário com e-mail ou login '${email}' / '${login}' já existe (ID: ${usuarioExistente.id}).`);
      
      console.log("Atualizando senha para 'clickpassword123'...");
      const hashPassword = await bcrypt.hash(senhaPlana, 10);

      // Vamos garantir que ele seja síndico no condomínio e atualizar a senha
      await prisma.users.update({
        where: { id: usuarioExistente.id },
        data: { 
          is_sindico: 1,
          password: hashPassword
        }
      });
      
      let sindico = await prisma.sindicos.findFirst({
        where: { id_user: usuarioExistente.id }
      });
      if (!sindico) {
        sindico = await prisma.sindicos.create({
          data: {
            name: usuarioExistente.name || name,
            email: usuarioExistente.email,
            id_user: usuarioExistente.id
          }
        });
      }
      
      const sc = await prisma.sindicos_Condominios.findFirst({
        where: {
          id_user: usuarioExistente.id,
          id_condominio: condominio.id
        }
      });
      if (!sc) {
        await prisma.sindicos_Condominios.create({
          data: {
            id_user: usuarioExistente.id,
            id_condominio: condominio.id
          }
        });
      }
      
      console.log(`\n==================================================`);
      console.log(`SÍNDICO ATUALIZADO COM SUCESSO!`);
      console.log(`Nome:  ${usuarioExistente.name || name}`);
      console.log(`Email: ${usuarioExistente.email || email}`);
      console.log(`Login: ${usuarioExistente.login || login}`);
      console.log(`Senha: ${senhaPlana}`);
      console.log(`Condomínio Vinculado: ${condominio.nome}`);
      console.log(`==================================================\n`);
      return;
    }

    // Gerar hash da senha
    console.log("Gerando hash da senha...");
    const hashPassword = await bcrypt.hash(senhaPlana, 10);

    // 3. Criar usuário
    console.log("Cadastrando usuário...");
    const user = await prisma.users.create({
      data: {
        email,
        login,
        password: hashPassword,
        name,
        is_sindico: 1,
        is_morador: 0,
        is_funcionario: 0,
      }
    });
    console.log(`Usuário criado com ID: ${user.id}`);

    // 4. Criar Síndico
    console.log("Criando registro de Síndico...");
    const sindico = await prisma.sindicos.create({
      data: {
        name,
        email,
        id_user: user.id,
      }
    });
    console.log(`Síndico criado com ID: ${sindico.id}`);

    // 5. Vincular Síndico ao Condomínio
    console.log("Vinculando síndico ao condomínio...");
    await prisma.sindicos_Condominios.create({
      data: {
        id_user: user.id,
        id_condominio: condominio.id
      }
    });

    console.log("\n==================================================");
    console.log("SÍNDICO CADASTRADO COM SUCESSO!");
    console.log(`Nome:  ${name}`);
    console.log(`Email: ${email}`);
    console.log(`Login: ${login}`);
    console.log(`Senha: ${senhaPlana}`);
    console.log(`Condomínio Vinculado: ${condominio.nome}`);
    console.log("==================================================\n");

  } catch (error) {
    console.error("Erro ao criar síndico:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
