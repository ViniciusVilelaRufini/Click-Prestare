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
                    e.retirado_por, e.status, e.foto_volume, e.id_condominio, c.nome as condominio_nome,
                    e.codigo_rastreio, e.codigo_validacao
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
   * Pré-registro do morador: uma encomenda que VAI CHEGAR (ex.: iFood).
   * Nasce com status 'Esperando' para o porteiro ver na portaria.
   * `codigo_validacao` é o código que o entregador pede (opcional).
   * `codigo_rastreio` fica preenchido só para transportadoras (auto-match/rastreio).
   */
  insertEsperado: async function (encomenda) {
    const esc = (v) => (v == null ? '' : String(v).replaceAll("'", "''"));
    const codigoRastreio = encomenda.codigo_rastreio
      ? `'${esc(encomenda.codigo_rastreio)}'`
      : 'NULL';
    const codigoValidacao = encomenda.codigo_validacao
      ? `'${esc(encomenda.codigo_validacao)}'`
      : 'NULL';

    const query = `insert into Encomendas
        (descricao, destinatario_apto, destinatario_bloco, recebido_de, status,
         id_condominio, notificado, codigo_rastreio, codigo_validacao)
      values ('${esc(encomenda.descricao)}', '${esc(encomenda.destinatario_apto)}',
              '${esc(encomenda.destinatario_bloco)}', '${esc(encomenda.recebido_de)}', 'Esperando',
              ${Number(encomenda.id_condominio)}, 0, ${codigoRastreio}, ${codigoValidacao})`;
    const result = await db.query(query);
    return result.results.insertId;
  },

  /**
   * Marca uma encomenda como retirada.
   */
  retirar: async function (id, retirado_por, retirado_foto) {
    // Parametrizado: a foto vem como data URL (base64 grande) e o nome é texto
    // livre — interpolar quebraria a query e abriria injecao.
    const query = `update Encomendas
                    set status='Retirada',
                    retirado_em=NOW(),
                    retirado_por=?,
                    retirado_foto=COALESCE(?, retirado_foto)
                    where id=?`;
    await db.queryParam(query, [retirado_por, retirado_foto ?? null, id]);
  },

  /**
   * Lista as encomendas de todos os condomínios/apartamentos vinculados ao morador.
   */
  getAllForResident: async function (userId, status) {
    let query = `select e.id, e.descricao, e.destinatario_apto, e.destinatario_bloco, e.recebido_de,
                    DATE_FORMAT(e.recebido_em, '%d/%m/%Y %H:%i') as recebido_em,
                    DATE_FORMAT(e.retirado_em, '%d/%m/%Y %H:%i') as retirado_em,
                    e.retirado_por, e.status, e.foto_volume, e.id_condominio, c.nome as condominio_nome,
                    e.codigo_rastreio, e.codigo_validacao
                    from Encomendas e
                    left join Condominios c on e.id_condominio = c.id
                    inner join (
                      select apto.id_condominio, apto.bloco, apto.apto 
                      from Apartamentos_Users au
                      inner join Apartamentos apto on apto.id = au.id_apto
                      where au.id_user = ${userId}
                    ) user_apto on e.id_condominio = user_apto.id_condominio 
                                and e.destinatario_bloco = user_apto.bloco COLLATE utf8mb4_unicode_ci
                                and e.destinatario_apto = user_apto.apto COLLATE utf8mb4_unicode_ci
                    where 1=1`;
                    
    if (status) query += ` and e.status='${status}'`;
    query += ` order by e.recebido_em desc`;
    
    const { results } = await db.query(query);
    return results;
  }
};
