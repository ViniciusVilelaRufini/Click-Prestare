/**
 * Apaga os dados de teste, preservando estrutura, Users, crm_admins e Planos.
 *
 * Modo padrão é DRY-RUN: lista o que seria apagado e não escreve nada.
 * Só apaga de verdade com --confirmo-apagar-tudo E o nome do banco alvo
 * digitado por extenso (segunda trava independente — um --confirmo-apagar-tudo
 * pode vir colado de um histórico de shell; o nome do banco tem que ser
 * digitado de propósito. Ele precisa bater com o banco que DATABASE_URL
 * aponta, senão o script recusa).
 *
 * ATENÇÃO: este script existia sob a premissa de "ainda não há cliente real,
 * todo dado em produção é dado de teste". Essa premissa expira quando dados
 * reais entrarem no banco — a partir daí, rodar isto é destruir produção.
 *
 * Preserva crm_admins porque é por onde o operador do wipe está logado (CRM).
 * Preserva Users porque a tabela guarda o login de TODO mundo que acessa o
 * sistema — síndico, morador e funcionário, não só o operador do CRM. Já
 * aconteceu de Users ser apagada por engano aqui (430 linhas -> 1); não
 * remover esta tabela da lista sem entender esse histórico.
 * Preserva Planos porque é tabela de catálogo, não dado de cliente.
 *
 * Uso:
 *   node --env-file=.env scripts/migration/wipe-test-data.mjs
 *   node --env-file=.env scripts/migration/wipe-test-data.mjs --confirmo-apagar-tudo <nome-do-banco>
 *
 * <nome-do-banco> deve ser exatamente o nome do banco em DATABASE_URL.
 */
import mysql from 'mysql2/promise';
import { contarTodasAsTabelas, buildConfig } from './dump-database.mjs';

const CONFIRMADO = process.argv.includes('--confirmo-apagar-tudo');

/** Tabelas que NÃO são apagadas. */
const PRESERVAR = new Set(['Users', 'crm_admins', 'Planos', '_prisma_migrations']);

/**
 * Tabelas cujo AUTO_INCREMENT não pode ser resetado para 1. `pessoas` começa
 * em 2000000 e `visitas` em 1000000 de propósito: vários pontos do código
 * resolvem um id contra mais de uma tabela, e as faixas de id disjuntas são
 * hoje a única coisa que impede essas buscas de colidir silenciosamente com
 * o registro de outra pessoa. Resetar o contador rearma essa colisão. Se
 * "limpar" isso um dia, restaure o offset original em vez de zerar.
 */
const OFFSET_AUTO_INCREMENT = { pessoas: 2000000, visitas: 1000000 };
const NAO_RESETAR_AUTO_INCREMENT = new Set(Object.keys(OFFSET_AUTO_INCREMENT));

/**
 * Segunda trava: o nome do banco alvo, passado como argumento posicional
 * logo após --confirmo-apagar-tudo (ou em qualquer posição, desde que não
 * seja a própria flag). Precisa bater com cfg.database.
 */
function bancoInformado() {
  const idx = process.argv.indexOf('--confirmo-apagar-tudo');
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

async function main() {
  const cfg = buildConfig();
  if (CONFIRMADO) {
    const nomeDigitado = bancoInformado();
    if (!nomeDigitado || nomeDigitado !== cfg.database) {
      console.error(
        `Confirmação insuficiente: informe o nome exato do banco alvo depois de --confirmo-apagar-tudo.\n` +
          `Esperado: "${cfg.database}"   Recebido: ${nomeDigitado ? `"${nomeDigitado}"` : '(nenhum)'}\n` +
          `Uso: node --env-file=.env scripts/migration/wipe-test-data.mjs --confirmo-apagar-tudo ${cfg.database}`,
      );
      process.exit(1);
    }
  }
  const conn = await mysql.createConnection(cfg);
  try {
    const antes = await contarTodasAsTabelas(conn, cfg.database);
    const alvo = Object.entries(antes)
      .map(([t, n]) => [t, Number(n)])
      .filter(([t, n]) => !PRESERVAR.has(t) && n > 0);
    const totalAlvo = alvo.reduce((a, [, n]) => a + n, 0);

    console.log(CONFIRMADO ? '=== APAGANDO ===' : '=== DRY-RUN (nada será apagado) ===');
    for (const [t, n] of alvo) console.log(`  ${t.padEnd(30)} ${String(n).padStart(8)} linhas`);
    console.log(`  ${'TOTAL'.padEnd(30)} ${String(totalAlvo).padStart(8)} linhas`);
    console.log('\nPreservadas:');
    for (const t of PRESERVAR) if (antes[t] !== undefined) console.log(`  ${t}: ${antes[t]} linhas`);

    if (!CONFIRMADO) {
      console.log('\nNada foi alterado. Para apagar de verdade, rode com --confirmo-apagar-tudo');
      return;
    }

    // FOREIGN_KEY_CHECKS=0 evita ter que descobrir a ordem topológica correta
    // das ~50 tabelas. Religado no finally, mesmo se algo falhar no meio.
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    try {
      for (const [t] of alvo) {
        await conn.query(`DELETE FROM \`${t}\``);
        if (NAO_RESETAR_AUTO_INCREMENT.has(t)) {
          // Restaura o offset original em vez de resetar para 1 — ver
          // comentário de OFFSET_AUTO_INCREMENT acima.
          await conn.query(`ALTER TABLE \`${t}\` AUTO_INCREMENT = ${OFFSET_AUTO_INCREMENT[t]}`);
        } else {
          await conn.query(`ALTER TABLE \`${t}\` AUTO_INCREMENT = 1`);
        }
        console.log(`  apagada: ${t}`);
      }
    } finally {
      await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    }

    const depois = await contarTodasAsTabelas(conn, cfg.database);
    const restantes = Object.entries(depois)
      .map(([t, n]) => [t, Number(n)])
      .filter(([t, n]) => !PRESERVAR.has(t) && n > 0);
    if (restantes.length) {
      console.error('\nAINDA HÁ LINHAS:', restantes.map(([t, n]) => `${t}=${n}`).join(', '));
      throw new Error(`Linhas remanescentes após wipe: ${restantes.map(([t, n]) => `${t}=${n}`).join(', ')}`);
    }
    console.log(
      `\nOK. Users preservados: ${depois['Users'] ?? 0}. crm_admins preservados: ${depois['crm_admins'] ?? 0}.`,
    );
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error('Wipe falhou:', e.message);
  process.exit(1);
});
