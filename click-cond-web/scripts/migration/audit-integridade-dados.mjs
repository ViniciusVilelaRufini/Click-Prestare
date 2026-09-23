/**
 * Auditoria de integridade dos dados no RDS — SOMENTE LEITURA.
 *
 * Só executa SELECT. Nenhum INSERT/UPDATE/DELETE/DDL. Pode rodar em produção
 * com o sistema no ar.
 *
 * Motivação: a tela pode mostrar tudo certo e o banco estar torto. As duas
 * tabelas centrais do fluxo de acesso não têm FK que garanta a consistência:
 *
 *  - `Acessos_Facial` referencia a pessoa de forma POLIMÓRFICA
 *    (tipo_pessoa + id_pessoa), sem FK. O banco não impede um evento apontar
 *    para uma pessoa que não existe mais.
 *  - `Acessos_Facial.id_device` também não tem FK para `Facial_Devices`.
 *  - `Visitantes` tem FK para apartamento e condomínio, mas nada garante que
 *    o apartamento pertença ao condomínio gravado na própria linha.
 *
 * Uso:
 *   node scripts/migration/audit-integridade-dados.mjs
 *   node scripts/migration/audit-integridade-dados.mjs --cond 1
 *
 * Conexão: DATABASE_URL (mysql://user:senha@host:porta/base) ou as
 * variáveis DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME.
 */
import mysql from 'mysql2/promise';

const argCond = (() => {
  const i = process.argv.indexOf('--cond');
  return i !== -1 && process.argv[i + 1] ? Number(process.argv[i + 1]) : null;
})();

function buildConfig() {
  const url = process.env.DATABASE_URL;
  if (url) {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: Number(u.port || 3306),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, ''),
      connectTimeout: 20000,
    };
  }
  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectTimeout: 20000,
  };
}

// Filtro opcional de condomínio, aplicado só onde a coluna existe.
const CF = (alias) => (argCond ? ` AND ${alias}.id_condominio = ${argCond} ` : '');

/**
 * Cada check: título, SQL que devolve as linhas problemáticas, e uma
 * explicação do que significa quando vem resultado. `ok` = 0 linhas.
 */
const CHECKS = [
  // ---------------------------------------------------------------- EVENTOS
  {
    grupo: 'EVENTOS DE ACESSO',
    titulo: 'Eventos apontando para MORADOR que não existe mais',
    porque:
      'tipo_pessoa/id_pessoa não tem FK. Morador excluído deixa o histórico apontando para o vazio — o evento vira órfão e relatórios por pessoa perdem essa entrada.',
    sql: `
      SELECT a.id, a.id_condominio, a.id_pessoa, a.nome_pessoa, a.timestamp
      FROM Acessos_Facial a
      LEFT JOIN Moradores m ON m.id = a.id_pessoa
      WHERE a.tipo_pessoa = 'morador' AND a.id_pessoa IS NOT NULL AND m.id IS NULL ${CF('a')}
      ORDER BY a.timestamp DESC LIMIT 20`,
  },
  {
    grupo: 'EVENTOS DE ACESSO',
    titulo: 'Eventos apontando para VISITANTE que não existe mais',
    porque:
      'Mesmo problema. Agravado porque Visitantes tem cascade delete vindo de Apartamentos: apagar um apartamento apaga os visitantes dele e órfã todo o histórico de acesso correspondente.',
    sql: `
      SELECT a.id, a.id_condominio, a.id_pessoa, a.nome_pessoa, a.timestamp
      FROM Acessos_Facial a
      LEFT JOIN Visitantes v ON v.id = a.id_pessoa
      WHERE a.tipo_pessoa IN ('visitante','prestador') AND a.id_pessoa IS NOT NULL AND v.id IS NULL ${CF('a')}
      ORDER BY a.timestamp DESC LIMIT 20`,
  },
  {
    grupo: 'EVENTOS DE ACESSO',
    titulo: 'Eventos gravados em dispositivo inexistente',
    porque:
      'id_device não tem FK para Facial_Devices. Device removido e recriado (id novo) deixa eventos antigos apontando para um id morto.',
    sql: `
      SELECT a.id, a.id_condominio, a.id_device, a.nome_pessoa, a.timestamp
      FROM Acessos_Facial a
      LEFT JOIN Facial_Devices d ON d.id = a.id_device
      WHERE d.id IS NULL ${CF('a')}
      ORDER BY a.timestamp DESC LIMIT 20`,
  },
  {
    grupo: 'EVENTOS DE ACESSO',
    titulo: '🔴 Evento gravado em condomínio DIFERENTE do dispositivo',
    porque:
      'Corrupção cross-tenant: o evento aparece no relatório do condomínio errado. Indica bug no gravador do evento — o id_condominio deveria vir sempre do device.',
    sql: `
      SELECT a.id, a.id_condominio AS cond_evento, d.id_condominio AS cond_device,
             a.id_device, a.nome_pessoa, a.timestamp
      FROM Acessos_Facial a
      JOIN Facial_Devices d ON d.id = a.id_device
      WHERE a.id_condominio <> d.id_condominio ${CF('a')}
      ORDER BY a.timestamp DESC LIMIT 20`,
  },
  {
    grupo: 'EVENTOS DE ACESSO',
    titulo: 'Eventos com timestamp impossível (futuro ou anterior a 2020)',
    porque:
      'Relógio do terminal errado ou replay offline mal interpretado (o campo UseTime do Dahua já causou isso). Quebra ordenação, contagem de ocupação e "último acesso".',
    sql: `
      SELECT a.id, a.id_condominio, a.nome_pessoa, a.timestamp, a.created_at
      FROM Acessos_Facial a
      WHERE (a.timestamp > DATE_ADD(NOW(), INTERVAL 1 DAY) OR a.timestamp < '2020-01-01') ${CF('a')}
      ORDER BY a.timestamp DESC LIMIT 20`,
  },
  {
    grupo: 'EVENTOS DE ACESSO',
    titulo: 'Eventos duplicados (mesma pessoa, mesmo device, mesmo segundo)',
    porque:
      'O dedup de 30s deveria evitar. Duplicata infla contagem de ocupação e pode indicar replay do agente local reprocessando eventos já gravados.',
    sql: `
      SELECT a.face_id, a.id_device, a.timestamp, COUNT(*) AS vezes,
             MIN(a.nome_pessoa) AS nome
      FROM Acessos_Facial a
      WHERE 1=1 ${CF('a')}
      GROUP BY a.face_id, a.id_device, a.timestamp
      HAVING COUNT(*) > 1
      ORDER BY vezes DESC LIMIT 20`,
  },

  // ------------------------------------------------------------- VISITANTES
  {
    grupo: 'VISITANTES',
    titulo: '🔴 Visitante cujo apartamento pertence a OUTRO condomínio',
    porque:
      'id_apartamento e id_condominio são FKs independentes — nada garante coerência entre elas. Visitante aparece na portaria do condomínio errado.',
    sql: `
      SELECT v.id, v.nome, v.id_condominio AS cond_visitante,
             ap.id_condominio AS cond_apartamento, v.id_apartamento
      FROM Visitantes v
      JOIN Apartamentos ap ON ap.id = v.id_apartamento
      WHERE v.id_condominio <> ap.id_condominio ${CF('v')}
      LIMIT 20`,
  },
  {
    grupo: 'VISITANTES',
    titulo: '🔴 Autorização pendente mas acesso já liberado',
    porque:
      'Na portaria remota o gate é a coluna `liberado`: pendente deve implicar liberado=0. Linha assim deixa entrar alguém que o morador ainda não autorizou.',
    sql: `
      SELECT v.id, v.nome, v.auth_status, v.liberado, v.auth_solicitado_em, v.id_condominio
      FROM Visitantes v
      WHERE v.auth_status = 'pendente' AND v.liberado = 1 ${CF('v')}
      LIMIT 20`,
  },
  {
    grupo: 'VISITANTES',
    titulo: '🔴 Visitante negado ou bloqueado, mas com acesso liberado',
    porque: 'Mesma família do anterior: a decisão de negar/bloquear não chegou na coluna que o webhook consulta.',
    sql: `
      SELECT v.id, v.nome, v.auth_status, v.bloqueado, v.liberado, v.id_condominio
      FROM Visitantes v
      WHERE v.liberado = 1 AND (v.auth_status = 'negado' OR v.bloqueado = 1) ${CF('v')}
      LIMIT 20`,
  },
  {
    grupo: 'VISITANTES',
    titulo: 'Mesma pessoa (mesmo documento) com face_id DIFERENTES',
    porque:
      'O cadastro deveria herdar o face_id de registro anterior com o mesmo CPF, para o terminal ver 1 pessoa e não várias. Divergência = rostos duplicados no aparelho.',
    sql: `
      SELECT v.id_condominio, v.doc_identificacao, COUNT(DISTINCT v.face_id) AS faces_distintos,
             COUNT(*) AS registros, MIN(v.nome) AS nome
      FROM Visitantes v
      WHERE v.doc_identificacao IS NOT NULL AND v.doc_identificacao <> ''
        AND v.face_id IS NOT NULL ${CF('v')}
      GROUP BY v.id_condominio, v.doc_identificacao
      HAVING COUNT(DISTINCT v.face_id) > 1
      LIMIT 20`,
  },
  {
    grupo: 'VISITANTES',
    titulo: 'Visitantes sem documento (quebram o agrupamento por pessoa)',
    porque:
      'A tela de pessoas agrupa por documento. Sem documento, cada visita vira uma "pessoa" separada e a contagem fica inflada.',
    sql: `
      SELECT v.id_condominio, COUNT(*) AS sem_documento
      FROM Visitantes v
      WHERE (v.doc_identificacao IS NULL OR v.doc_identificacao = '') ${CF('v')}
      GROUP BY v.id_condominio
      LIMIT 20`,
  },
  {
    grupo: 'VISITANTES',
    titulo: 'Enroll facial inconsistente (marcado como enrolado, sem face_id)',
    porque:
      'face_enrolled_at preenchido com face_id nulo significa que o sistema acha que sincronizou mas não tem a referência — a pessoa não vai ser reconhecida.',
    sql: `
      SELECT v.id, v.nome, v.face_sync_status, v.face_enrolled_at, v.face_sync_error, v.id_condominio
      FROM Visitantes v
      WHERE v.face_enrolled_at IS NOT NULL AND (v.face_id IS NULL OR v.face_id = '') ${CF('v')}
      LIMIT 20`,
  },
  {
    grupo: 'VISITANTES',
    titulo: 'Falhas de sincronização facial registradas',
    porque: 'face_sync_status de erro: a pessoa está cadastrada no sistema mas não no terminal. Cadastro "parece" completo na tela.',
    sql: `
      SELECT v.id, v.nome, v.face_sync_status, LEFT(COALESCE(v.face_sync_error,''), 120) AS erro, v.id_condominio
      FROM Visitantes v
      WHERE v.face_sync_status IS NOT NULL
        AND v.face_sync_status NOT IN ('ok','sincronizado','synced','enrolled') ${CF('v')}
      LIMIT 20`,
  },
  {
    grupo: 'VISITANTES',
    titulo: 'Pessoas "dentro" há mais de 24h (entrada sem saída)',
    porque:
      'Alimenta a contagem de ocupação. Entrada sem saída correspondente trava o contador e pode disparar anti-passback indevido na próxima entrada.',
    sql: `
      SELECT v.id, v.nome, v.data_entrada, v.data_saida, v.id_condominio
      FROM Visitantes v
      WHERE v.data_entrada IS NOT NULL AND v.data_saida IS NULL
        AND v.data_entrada < DATE_SUB(NOW(), INTERVAL 24 HOUR) ${CF('v')}
      ORDER BY v.data_entrada ASC LIMIT 20`,
  },

  // ------------------------------------------------- DUPLICAÇÃO DE MORADORES
  {
    grupo: 'MORADORES (duas fontes de verdade)',
    titulo: 'Usuários em Apartamentos_Users que NÃO estão em Moradores',
    porque:
      'As duas tabelas descrevem "quem mora onde". Feature que consulte só Moradores vai ignorar essas pessoas.',
    sql: `
      SELECT au.id_user, au.id_apto, ap.id_condominio
      FROM Apartamentos_Users au
      JOIN Apartamentos ap ON ap.id = au.id_apto
      LEFT JOIN Moradores m ON m.id_user = au.id_user
      WHERE m.id IS NULL ${argCond ? ` AND ap.id_condominio = ${argCond} ` : ''}
      LIMIT 20`,
  },
  {
    grupo: 'MORADORES (duas fontes de verdade)',
    titulo: 'Moradores que NÃO estão em Apartamentos_Users',
    porque:
      'O inverso. A auditoria de segurança de 2026 passou a resolver permissão por Apartamentos_Users — quem só existe em Moradores pode tomar "acesso negado" indevido.',
    sql: `
      SELECT m.id, m.nome, m.id_user, m.id_condominio
      FROM Moradores m
      LEFT JOIN Apartamentos_Users au ON au.id_user = m.id_user
      WHERE au.id_user IS NULL ${CF('m')}
      LIMIT 20`,
  },
];

// Panorama: o que existe e o que chegou por último em cada tabela do fluxo.
const PANORAMA = [
  { tabela: 'Acessos_Facial', ts: 'timestamp' },
  { tabela: 'Visitantes', ts: 'created_at' },
  { tabela: 'Facial_Devices', ts: null },
  { tabela: 'Moradores', ts: null },
  { tabela: 'Apartamentos_Users', ts: null },
  { tabela: 'Prestadores_servico', ts: null },
  { tabela: 'Convites_Visita', ts: null },
  { tabela: 'Vagas', ts: null },
];

async function main() {
  const cfg = buildConfig();
  if (!cfg.host || !cfg.password) {
    console.error('❌ Defina DATABASE_URL ou DB_HOST/DB_USER/DB_PASSWORD/DB_NAME.');
    process.exit(1);
  }

  console.log('═'.repeat(78));
  console.log('AUDITORIA DE INTEGRIDADE — SOMENTE LEITURA');
  console.log(`Banco: ${cfg.host}:${cfg.port}/${cfg.database}`);
  console.log(argCond ? `Escopo: condomínio ${argCond}` : 'Escopo: todos os condomínios');
  console.log('═'.repeat(78));

  const conn = await mysql.createConnection(cfg);
  // Cinto de segurança: mesmo que alguém edite um SQL acima, a sessão não escreve.
  await conn.query('SET SESSION TRANSACTION READ ONLY');

  try {
    console.log('\n── PANORAMA ──────────────────────────────────────────────────────────\n');
    for (const p of PANORAMA) {
      try {
        const [[row]] = await conn.query(
          `SELECT COUNT(*) AS total${p.ts ? `, MAX(${p.ts}) AS ultimo` : ''} FROM ${p.tabela}`,
        );
        const ultimo = p.ts ? `   último: ${row.ultimo ?? '—'}` : '';
        console.log(`  ${p.tabela.padEnd(22)} ${String(row.total).padStart(8)} linhas${ultimo}`);
      } catch (e) {
        console.log(`  ${p.tabela.padEnd(22)} (erro: ${e.message})`);
      }
    }

    let problemas = 0;
    let grupoAtual = '';
    for (const c of CHECKS) {
      if (c.grupo !== grupoAtual) {
        grupoAtual = c.grupo;
        console.log(`\n── ${grupoAtual} ${'─'.repeat(Math.max(0, 68 - grupoAtual.length))}\n`);
      }
      let rows;
      try {
        [rows] = await conn.query(c.sql);
      } catch (e) {
        console.log(`  ⚠️  ${c.titulo}\n      não pôde ser verificado: ${e.message}\n`);
        continue;
      }
      if (!rows.length) {
        console.log(`  ✅ ${c.titulo}`);
        continue;
      }
      problemas++;
      console.log(`  ❌ ${c.titulo} — ${rows.length} ocorrência(s)${rows.length === 20 ? ' (limitado a 20)' : ''}`);
      console.log(`      ${c.porque}`);
      console.table(rows.slice(0, 5));
    }

    console.log('\n' + '═'.repeat(78));
    console.log(
      problemas === 0
        ? '✅ Nenhuma inconsistência encontrada nos pontos auditados.'
        : `❌ ${problemas} verificação(ões) com inconsistência. Detalhes acima.`,
    );
    console.log('═'.repeat(78));
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error('Falhou:', e.message);
  process.exit(1);
});
