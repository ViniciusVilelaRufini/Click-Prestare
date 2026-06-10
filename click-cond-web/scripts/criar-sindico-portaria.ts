import { PrismaClient } from '../apps/api/src/app/prisma/generated';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  try {
    console.log("Conectando ao banco de dados...");
    
    // 1. Buscar primeiro condomínio
    const condominio = await prisma.condominios.findFirst();
    if (!condominio) {
      console.log("Erro: Nenhum condomínio cadastrado no banco de dados.");
      return;
    }
    console.log(`Usando condomínio: "${condominio.nome}" (ID: ${condominio.id})`);

    // 2. Dados de acesso
    const login = "sindico@click.com";
    const nome = "Sindico Railway";
    const email = "sindico@click.com";
    const senhaPlana = "clickpassword123";
    const turno = "Síndico"; // Crucial para o frontend não tratar como porteiro comum

    // 3. Gerar hash bcrypt da senha
    console.log("Gerando hash da senha...");
    const hashPassword = await bcrypt.hash(senhaPlana, 10);

    // 4. Verificar se já existe na tabela Funcionarios_Portaria
    const existente = await prisma.funcionarios_Portaria.findFirst({
      where: { login: login }
    });

    if (existente) {
      console.log(`Usuário de Portaria com login '${login}' já existe (ID: ${existente.id}). Atualizando senha e turno...`);
      await prisma.funcionarios_Portaria.update({
        where: { id: existente.id },
        data: {
          password: hashPassword,
          turno: turno,
          ativo: 1,
          id_condominio: condominio.id
        }
      });
    } else {
      console.log(`Cadastrando novo registro de Portaria para o Síndico...`);
      await prisma.funcionarios_Portaria.create({
        data: {
          nome: nome,
          login: login,
          password: hashPassword,
          email: email,
          turno: turno,
          ativo: 1,
          id_condominio: condominio.id
        }
      });
    }

    console.log("\n==================================================");
    console.log("CONTA DE ACESSO WEB GERADA COM SUCESSO!");
    console.log(`Identificador / Usuário: ${login}`);
    console.log(`Senha de Segurança:     ${senhaPlana}`);
    console.log(`Condomínio Vinculado:   ${condominio.nome}`);
    console.log(`Tipo de Acesso:         Síndico (Acesso total habilitado)`);
    console.log("==================================================\n");

  } catch (error) {
    console.error("Erro ao gerar conta de portaria para o síndico:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
