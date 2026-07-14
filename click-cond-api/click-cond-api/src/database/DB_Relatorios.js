const db = require('./MySQL.js');

/**
 * Consultas dos relatórios (visitantes/encomendas/ocorrências/financeiro).
 * Paridade com o RelatoriosService do NestJS, porém em SQL cru (mesmo banco).
 */

/**
 * Monta um filtro de data que casa se QUALQUER uma das colunas cair no intervalo
 * (equivalente ao OR do Prisma). Retorna { clause, params }.
 * start/end são strings 'YYYY-MM-DD HH:mm:ss' ou null.
 */
function dateOr(cols, start, end) {
  if (!start && !end) return { clause: '', params: [] };
  const parts = [];
  const params = [];
  for (const c of cols) {
    if (start && end) {
      parts.push(`${c} BETWEEN ? AND ?`);
      params.push(start, end);
    } else if (start) {
      parts.push(`${c} >= ?`);
      params.push(start);
    } else {
      parts.push(`${c} <= ?`);
      params.push(end);
    }
  }
  return { clause: ` AND (${parts.join(' OR ')})`, params };
}

module.exports = {
  getCondominioNome: async function (idCond) {
    const { results } = await db.queryParam('select nome from Condominios where id=?', [idCond]);
    return results[0] ? results[0].nome : 'Condomínio';
  },

  getVisitantes: async function (idCond, start, end) {
    const f = dateOr(['v.created_at', 'v.data_entrada', 'v.data_saida', 'v.data_hora_inicio'], start, end);
    const query = `select v.nome, v.doc_identificacao, apto.apto, apto.bloco,
                     v.data_entrada, v.data_saida, v.created_at, u.name as criado_por
                   from Visitantes v
                   left join Apartamentos apto on apto.id = v.id_apartamento
                   left join Users u on u.id = v.user
                   where v.id_condominio = ?${f.clause}
                   order by v.created_at desc`;
    const { results } = await db.queryParam(query, [idCond, ...f.params]);
    return results;
  },

  getEncomendas: async function (idCond, start, end) {
    const f = dateOr(['e.recebido_em', 'e.retirado_em'], start, end);
    const query = `select e.descricao, e.destinatario_apto, e.destinatario_bloco, e.recebido_de,
                     e.recebido_em, e.retirado_em, e.status, u.name as recebido_por
                   from Encomendas e
                   left join Users u on u.id = e.recebido_por_user
                   where e.id_condominio = ?${f.clause}
                   order by e.recebido_em desc`;
    const { results } = await db.queryParam(query, [idCond, ...f.params]);
    return results;
  },

  getOcorrencias: async function (idCond, start, end) {
    const f = dateOr(['o.created_at', 'o.resposta_at'], start, end);
    const query = `select o.tipo as categoria, o.descricao, o.status, o.created_at,
                     o.resposta, o.resposta_at, u.name as criado_por
                   from Ocorrencias o
                   left join Users u on u.id = o.user
                   where o.id_condominio = ?${f.clause}
                   order by o.created_at desc`;
    const { results } = await db.queryParam(query, [idCond, ...f.params]);
    return results;
  },

  getFinanceiro: async function (idCond, start, end) {
    const f = dateOr(['f.created_at', 'f.data', 'f.data_vencimento'], start, end);
    const query = `select f.nome, f.tipo, f.valor, f.data_vencimento, f.categoria,
                     f.status, f.pago, f.forma_pagamento
                   from Financeiro f
                   where f.id_condominio = ?${f.clause}
                   order by f.created_at desc`;
    const { results } = await db.queryParam(query, [idCond, ...f.params]);
    return results;
  },
};
