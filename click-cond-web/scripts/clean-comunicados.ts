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

const COND_NOME = 'Teste Banco';
const SINDICO_USER_ID = 138;

const rand = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

async function main() {
  console.log('🔌 Conectando ao banco...');
  
  const cond = await prisma.condominios.findFirst({ where: { nome: COND_NOME } });
  if (!cond) {
    console.log(`❌ Condomínio "${COND_NOME}" não encontrado.`);
    return;
  }
  
  console.log(`🧹 Removendo comunicados de teste antigos do condomínio ${cond.nome} (id=${cond.id})...`);
  const deleted = await prisma.comunicados.deleteMany({
    where: {
      id_condominio: cond.id,
      titulo: {
        startsWith: '[TESTE]'
      }
    }
  });
  console.log(`✓ Removidos ${deleted.count} comunicados.`);

  console.log('📢 Criando novos comunicados com títulos e descrições alinhados...');
  const titulosCom = [
    'Manutenção da piscina', 'Dedetização programada', 'Reunião de condomínio',
    'Mudança no horário da portaria', 'Limpeza da caixa d\'água', 'Falta d\'água',
    'Festa de fim de ano', 'Eleição de síndico', 'Reforma da fachada',
    'Novo regimento interno', 'Coleta seletiva', 'Vacinação de animais',
  ];

  for (let i = 0; i < 20; i++) {
    const tema = rand(titulosCom);
    await prisma.comunicados.create({
      data: {
        titulo: `[TESTE] ${tema} - #${i + 1}`,
        descricao: `Prezados moradores, comunicamos que ${tema.toLowerCase()} ocorrerá em breve. Detalhes adicionais serão enviados em comunicado complementar.\n\nAtenciosamente,\nAdministração.`,
        user: SINDICO_USER_ID,
        id_condominio: cond.id,
      },
    });
  }
  console.log('✓ 20 novos comunicados criados com sucesso!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
