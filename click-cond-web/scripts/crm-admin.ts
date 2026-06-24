import { PrismaClient } from '../apps/api/src/app/prisma/generated';
import * as bcrypt from 'bcrypt';
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

/**
 * Uso:
 *   list                         -> lista admins (login, nome, ativo)
 *   set <login> <nome> <senha>   -> cria ou atualiza admin com senha bcrypt e ativo=1
 */
async function main() {
  const [cmd, login, nome, senha] = process.argv.slice(2);

  if (cmd === 'list') {
    const admins = await prisma.crm_Admins.findMany({
      select: { id: true, login: true, nome: true, ativo: true },
    });
    console.log(JSON.stringify(admins, null, 2));
    return;
  }

  if (cmd === 'set') {
    if (!login || !senha) {
      console.error('Uso: set <login> <nome> <senha>');
      process.exit(1);
    }
    const hash = await bcrypt.hash(senha, 10);
    const admin = await prisma.crm_Admins.upsert({
      where: { login },
      update: { password: hash, nome: nome || login, ativo: 1 },
      create: { login, nome: nome || login, password: hash, ativo: 1 },
    });
    console.log(`✅ Admin pronto: login="${admin.login}" nome="${admin.nome}" ativo=${admin.ativo}`);
    return;
  }

  console.log('Comandos: list | set <login> <nome> <senha>');
}

main()
  .catch((e) => {
    console.error('❌ Erro:', e.message || e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
