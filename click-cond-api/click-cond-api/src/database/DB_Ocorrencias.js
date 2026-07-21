const db = require('./MySQL.js');

module.exports = {
  insert: async function (id_condominio, ocorrencia, user_id, listDocs) {
    ocorrencia.descricao = ocorrencia.descricao.replaceAll("'","''");

    // SLA: prazo = now() + sla_horas da categoria (se houver). Subquery evita 2 round-trips.
    const prazoExpr = `(select case when oc.sla_horas is not null then date_add(now(), interval oc.sla_horas hour) else null end
                        from Ocorrencias_Categorias oc where oc.id='${ocorrencia.tipo}')`;
    const query = `insert into Ocorrencias (descricao, anexos, user, id_condominio, tipo, prazo)
						values ('${ocorrencia.descricao}','${listDocs.join(";")}', ${user_id}, ${id_condominio}, '${ocorrencia.tipo}', ${prazoExpr})`;
    await db.query(query);
  },

  getAll: async function (id_cond, offset, status, idUser) {
    const query = `select o.id, o.descricao, o.anexos, o.status, COALESCE(oc.nome, 'Outros') as tipo, oc.sla_horas, o.resposta, u.login,
                    o.prazo as prazo_raw, o.id_responsavel, r.name as responsavelNome,
                    DATE_FORMAT(o.created_at, '%d/%m/%Y às %H:%i') as created_at,
                    DATE_FORMAT(o.resposta_at, '%d/%m/%Y às %H:%i') as resposta_at
                    from Ocorrencias o
                      left join Ocorrencias_Categorias oc on o.tipo = oc.id
                      left join Users u on u.id=o.\`user\`
                      left join Users r on r.id=o.id_responsavel
                    where o.id_condominio=${id_cond}
                      ${status == 'pendente' ? ` and o.status='Pendente'` : ''}
                      ${idUser != null ? ` and (o.\`user\`=${idUser} OR o.\`user\` IS NULL)` : ''}
                    order by COALESCE(oc.prioridade, 99), FIELD(o.status, 'Pendente', 'Ciente', 'Solucionado'), o.created_at desc
                    limit 30 offset ${offset || 0}`;
    console.log('[DB_Ocorrencias.getAll] Query:', query.substring(0, 300));
    const result = await db.query(query);
    console.log('[DB_Ocorrencias.getAll] Status:', result.status, 'Count:', result.results?.length);
    if (result.status === 'Error') {
      console.error('[DB_Ocorrencias.getAll] SQL Error:', result.error?.sqlMessage || result.error?.message);
    }
    return result.results;
  },

  remove: async function (id) {
    const query = `delete from Ocorrencias where id=${id}`;
    await db.query(query);
  },

  update: async function (id_condominio, ocorrencia, user_id, listDocs) {
    ocorrencia.descricao = ocorrencia.descricao.replaceAll("'","''");

    const query = `update Ocorrencias 
                     set descricao='${ocorrencia.descricao}',
                      anexos='${listDocs.join(";")}',
                      user='${user_id}'  
                    where id=${ocorrencia.id} and id_condominio=${id_condominio}`;
                    console.log(query);

    await db.query(query);
  },

  setResposta: async function (id_condominio, ocorrencia, user_id) {
    ocorrencia.descricao = ocorrencia.descricao.replaceAll("'","''");
    
    const query = `update Ocorrencias 
                     set resposta='${ocorrencia.descricao}',
                         status='${ocorrencia.status}',
                         resposta_at=now()
                    where id=${ocorrencia.id} and id_condominio=${id_condominio}`;
                    console.log(query);

    await db.query(query);
  },
    
  get: async function (id_cond, id) {
    const query = `select o.id, o.descricao, o.anexos, o.status, COALESCE(oc.nome, 'Outros') as tipo, oc.id as tipoId, oc.sla_horas, o.resposta,
                    o.prazo as prazo_raw, o.id_responsavel, r.name as responsavelNome,
                    DATE_FORMAT(o.created_at, '%d/%m/%Y às %H:%i') as created_at,
                    DATE_FORMAT(o.resposta_at, '%d/%m/%Y às %H:%i') as resposta_at
                    from Ocorrencias o
                      left join Ocorrencias_Categorias oc on o.tipo = oc.id
                      left join Users r on r.id=o.id_responsavel
                    where o.id_condominio=${id_cond} and o.id=${id}`;
                    console.log(query);
    const { results } = await db.query(query);
    return results[0];
  },

  updateStatus: async function (id_condominio, id, status) {
    const query = `update Ocorrencias
                     set status='${status}'
                     where id=${id} and id_condominio=${id_condominio}`;
    await db.query(query);
  },

  updateResponsavel: async function (id_condominio, id, id_responsavel) {
    const val = (id_responsavel === null || id_responsavel === undefined || id_responsavel === '')
      ? 'NULL' : `${Number(id_responsavel)}`;
    const query = `update Ocorrencias set id_responsavel=${val}
                    where id=${id} and id_condominio=${id_condominio}`;
    await db.query(query);
  },

  getAllCategorias: async function () {
    const query = `select * from Ocorrencias_Categorias order by prioridade asc`;
    const { results } = await db.query(query);
    return results;
  },

  insertCategoria: async function (cat) {
    const nome = (cat.nome || '').replaceAll("'","''");
    const prioridade = Number(cat.prioridade) || 0;
    const sla = (cat.sla_horas === null || cat.sla_horas === undefined || cat.sla_horas === '') ? 'NULL' : Number(cat.sla_horas);
    const query = `insert into Ocorrencias_Categorias (nome, prioridade, sla_horas) values ('${nome}', ${prioridade}, ${sla})`;
    await db.query(query);
  },

  updateCategoria: async function (id, cat) {
    const nome = (cat.nome || '').replaceAll("'","''");
    const prioridade = Number(cat.prioridade) || 0;
    const sla = (cat.sla_horas === null || cat.sla_horas === undefined || cat.sla_horas === '') ? 'NULL' : Number(cat.sla_horas);
    const query = `update Ocorrencias_Categorias set nome='${nome}', prioridade=${prioridade}, sla_horas=${sla} where id=${id}`;
    await db.query(query);
  },

  removeCategoria: async function (id) {
    const query = `delete from Ocorrencias_Categorias where id=${id}`;
    await db.query(query);
  },

  getCreatorId: async function (id) {
    const query = `SELECT user FROM Ocorrencias WHERE id = ${id}`;
    const { results } = await db.query(query);
    return results[0]?.user;
  },
};
