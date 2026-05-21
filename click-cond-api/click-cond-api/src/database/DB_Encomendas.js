const db = require('./MySQL.js');

module.exports = {
  /**
   * Lista as encomendas de um condomínio.
   * Filtros opcionais por bloco e apartamento para o morador ver as suas.
   */
  getAll: async function (id_cond, status, bloco, apto) {
    let query = `select e.id, e.descricao, e.destinatario_apto, e.destinatario_bloco, e.recebido_de, 
                    DATE_FORMAT(e.recebido_em, '%d/%m/%Y %H:%i') as recebido_em,
                    DATE_FORMAT(e.retirado_em, '%d/%m/%Y %H:%i') as retirado_em,
                    e.retirado_por, e.status, e.foto_volume, e.id_condominio, c.nome as condominio_nome
                    from Encomendas e
                    left join Condominios c on e.id_condominio = c.id
                    where e.id_condominio=${id_cond}`;
    
    if (status) query += ` and e.status='${status}'`;
    if (bloco) query += ` and e.destinatario_bloco='${bloco}'`;
    if (apto) query += ` and e.destinatario_apto='${apto}'`;
    
    query += ` order by e.recebido_em desc`;
    
    const { results } = await db.query(query);
    return results;
  },

  /**
   * Busca uma encomenda específica.
   */
  get: async function (id) {
    const query = `select * from Encomendas where id=${id}`;
    const { results } = await db.query(query);
    return results[0];
  },

  /**
   * Cria uma nova encomenda (usado principalmente pela portaria web, 
   * mas deixamos aqui para compatibilidade).
   */
  insert: async function (encomenda) {
    const query = `insert into Encomendas (descricao, destinatario_apto, destinatario_bloco, recebido_de, status, id_condominio, foto_volume)
                    values ('${encomenda.descricao}', '${encomenda.destinatario_apto}', '${encomenda.destinatario_bloco || ''}', 
                    '${encomenda.recebido_de || ''}', 'Aguardando', ${encomenda.id_condominio}, '${encomenda.foto_volume || ''}')`;
    await db.query(query);
  },

  /**
   * Marca uma encomenda como retirada.
   */
  retirar: async function (id, retirado_por) {
    const query = `update Encomendas 
                    set status='Retirada', 
                    retirado_em=NOW(), 
                    retirado_por='${retirado_por}'
                    where id=${id}`;
    await db.query(query);
  }
};
