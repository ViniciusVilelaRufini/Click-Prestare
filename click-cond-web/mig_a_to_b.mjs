/**
 * Migração: Funcionarios_Portaria (A) → Prestadores_servico (B)
 *
 * Copia porteiros reais (sem "[TESTE FUNC]" no nome) para a tabela B,
 * que é a base unificada de "Funcionários do Condomínio" no app e na web.
 *
 * Seguro para rodar múltiplas vezes: pula quem já existe (por nome + id_condominio).
 * Não altera nem deleta nada em Funcionarios_Portaria.
 *
 * Uso:
 *   node mig_a_to_b.mjs           → dry-run (só mostra o que faria)
 *   APPLY=1 node mig_a_to_b.mjs   → aplica de verdade
 */

import { PrismaClient } from './apps/api/src/app/prisma/generated/client.js';

const APPLY = process.env.APPLY === '1';
const prisma = new PrismaClient();

async function main() {
  // Busca todos os porteiros, excluindo registros de teste
  const porteiros = await prisma.funcionarios_Portaria.findMany({
    where: {
      nome: { not: { contains: '[TESTE FUNC]' } },
    },
    orderBy: { id: 'asc' },
  });

  console.log(`\nPorteiros reais encontrados em Funcionarios_Portaria: ${porteiros.length}`);
  if (porteiros.length === 0) {
    console.log('Nada a migrar.');
    return;
  }

  let inseridos = 0;
  let pulados = 0;

  for (const p of porteiros) {
    // Verifica se já existe em Prestadores_servico (mesmo nome + condomínio)
    const existe = await prisma.prestadores_servico.findFirst({
      where: {
        nome: p.nome.trim(),
        id_condominio: p.id_condominio,
      },
      select: { id: true },
    });

    if (existe) {
      console.log(`  PULAR  [id=${p.id}] "${p.nome}" (cond ${p.id_condominio}) → já existe como prestador id=${existe.id}`);
      pulados++;
      continue;
    }

    console.log(`  INSERIR [id=${p.id}] "${p.nome}" (cond ${p.id_condominio}, telefone=${p.telefone ?? '-'})`);

    if (APPLY) {
      await prisma.prestadores_servico.create({
        data: {
          nome: p.nome.trim(),
          telefone: p.telefone ?? null,
          categorias: 'Portaria',
          id_condominio: p.id_condominio,
          dias_semana: 'seg,ter,qua,qui,sex',
        },
      });
    }
    inseridos++;
  }

  console.log(`\nResumo:`);
  console.log(`  A inserir : ${inseridos}`);
  console.log(`  A pular   : ${pulados}`);
  if (!APPLY) {
    console.log('\n[DRY-RUN] Nada foi gravado. Para aplicar: APPLY=1 node mig_a_to_b.mjs');
  } else {
    console.log('\n[APLICADO] Migração concluída.');
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
