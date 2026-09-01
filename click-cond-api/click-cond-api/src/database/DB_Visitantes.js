const db = require('./MySQL.js');

module.exports = {
  insert: async function (id_condominio, visitante, user_id) {
    visitante.nome = visitante.nome.replaceAll("'","''");
    
    // Gerar PIN único e ativo
    let pin = '';
    let isUnique = false;
    while (!isUnique) {
      pin = Math.floor(100000 + Math.random() * 900000).toString();
      const check = await db.query(`select id from Visitantes where codigo_acesso='${pin}' and data_saida is null limit 1`);
      if (!check.results || check.results.length === 0) {
        isUnique = true;
      }
    }
    
    // liberado=1: visitante criado pelo morador/app já nasce autorizado (mesma
    // regra do backend NestJS). Sem isso, a validação do PIN (que exige
    // liberado=1) nega "não foi autorizada pelo morador ou portaria".
    const query = `insert into Visitantes (nome, doc_identificacao, data_hora_inicio, data_hora_termino, is_visitante, is_prestador, user, id_apartamento, id_condominio, avisar, foto_documento, foto_pessoa, codigo_acesso, liberado, dias_semana)
						values ('${visitante.nome}','${visitante.doc_identificacao}','${visitante.data_inicio}','${visitante.data_termino}',${visitante.is_visitante}, ${visitante.is_prestador}, ${user_id}, ${visitante.id_apartamento}, ${id_condominio}, 1, '${visitante.foto_documento || ''}', '${visitante.foto_pessoa || ''}', '${pin}', 1, '${visitante.dias_semana || ''}')`;
            console.log(query);
    const result = await db.query(query);
    return { id: result.results.insertId, codigo_acesso: pin };
  },

  getAll: async function (id_cond, offset, id_apto, search, userId, idAptos) {
    let query = `select v.id, v.nome, v.doc_identificacao, 
                    DATE_FORMAT(v.data_hora_inicio, '%d/%m/%Y') as data_hora,
                    DATE_FORMAT(v.data_entrada, '%H:%i') as hora_entrada,
                    DATE_FORMAT(v.data_saida, '%H:%i') as hora_saida,
                    v.data_entrada, v.data_saida,
                    v.data_hora_inicio, v.data_hora_termino,
                    v.is_visitante, v.is_prestador, u.login,
                    apto.apto, apto.bloco as apto_bloco, apto.id as apto_id,
                    v.foto_documento, v.foto_pessoa, c.nome as condominio_nome,
                    v.codigo_acesso
                    from Visitantes v
                    inner join Apartamentos apto on apto.id=v.id_apartamento
                    left join Users u on u.id=v.user
                    left join Condominios c on c.id=v.id_condominio
                    where 1=1`;
    
    if (id_cond) {
      query += ` and v.id_condominio=${id_cond}`;
    }
    if (id_apto) {
      query += ` and v.id_apartamento=${Number(id_apto)}`;
    } else if (Array.isArray(idAptos) && idAptos.length > 0) {
      // Usuário restrito sem apto específico: filtra por TODOS os aptos dele.
      const ids = idAptos.map((x) => Number(x)).filter((n) => !Number.isNaN(n));
      if (ids.length > 0) query += ` and v.id_apartamento in (${ids.join(',')})`;
    }
    if (userId) {
      query += ` and (v.id_apartamento in (select id_apto from Apartamentos_Users where id_user=${Number(userId)}) or v.user=${Number(userId)})`;
    }
    if (search) {
      query += ` and (v.nome like '%${search}%' or v.doc_identificacao like '%${search}%' or apto.apto like '%${search}%')`;
    }
    
    query += ` order by data_hora_inicio desc
              limit 30 offset ${offset}`;
              
    const { results } = await db.query(query);
    return results;
  },

  remove: async function (id) {
    const query = `delete from Visitantes where id=${id}`;
    await db.query(query);
  },

  update: async function (id_condominio, visitante) {
    visitante.nome = visitante.nome.replaceAll("'","''");

    // Só atualiza a foto quando vier um valor — assim uma edição sem foto não
    // apaga a imagem já salva (paridade com o NestJS, que faz fallback ao anterior).
    const setFotoPessoa = visitante.foto_pessoa
      ? `, foto_pessoa='${String(visitante.foto_pessoa).replaceAll("'", "''")}'`
      : '';
    const setFotoDocumento = visitante.foto_documento
      ? `, foto_documento='${String(visitante.foto_documento).replaceAll("'", "''")}'`
      : '';

    // dias_semana só é atualizado quando enviado (prestador); undefined não mexe.
    const setDiasSemana = visitante.dias_semana !== undefined
      ? `, dias_semana='${String(visitante.dias_semana || '').replaceAll("'", "''")}'`
      : '';

    const query = `update Visitantes
                     set nome='${visitante.nome}',
                      doc_identificacao='${visitante.doc_identificacao}',
                      data_hora_inicio='${visitante.data_inicio}',
                      data_hora_termino='${visitante.data_termino}',
                      is_visitante=${visitante.is_visitante},
                      is_prestador=${visitante.is_prestador},
                      id_apartamento=${visitante.id_apartamento}${setFotoDocumento}${setFotoPessoa}${setDiasSemana}
                    where id=${visitante.id} `;
    await db.query(query);
  },
    
  get: async function (id_cond, id) {
    const query = `select v.id, v.nome, v.doc_identificacao, 
                      DATE_FORMAT(v.data_hora_inicio, '%d/%m/%Y %H:%i') as data_inicio, 
                      DATE_FORMAT(v.data_hora_termino, '%d/%m/%Y %H:%i') as data_termino, 
                      v.is_visitante, v.is_prestador,
                      v.foto_documento, v.foto_pessoa,
                      apto.apto, apto.bloco as apto_bloco, apto.id as apto_id,
                      v.codigo_acesso, v.dias_semana
                    from Visitantes v
                    inner join Apartamentos apto on apto.id=v.id_apartamento
                      where v.id_condominio=${id_cond} and v.id=${id}`;
    const { results } = await db.query(query);
    return results[0];
  },

  getById: async function (id) {
    const query = `select * from Visitantes where id=${id}`;
    const { results } = await db.query(query);
    return results[0];
  },
  
  checkIn: async function (id) {
    const query = `update Visitantes set data_entrada=NOW(), data_saida=NULL where id=${id}`;
    await db.query(query);
  },

  checkOut: async function (id) {
    const query = `update Visitantes set data_saida=NOW() where id=${id}`;
    await db.query(query);
  },

  // Marca o rosto do visitante como pendente de sincronização. O back-fill do
  // NestJS (tickSyncRetry / onlyPending) enrola quem está pending/face_id nulo.
  marcarFacialPendente: async function (id) {
    await db.query(`update Visitantes set face_sync_status='pending' where id=${parseInt(id)}`);
  },

  // ===== Portaria remota — autorização em tempo real =====
  getApartamentoById: async function (id) {
    const { results } = await db.query(
      `select id, id_condominio, apto, bloco from Apartamentos where id=${parseInt(id)}`,
    );
    return results[0];
  },

  solicitarAutorizacao: async function (id, redirecionarApto) {
    const setApto = redirecionarApto ? `id_apartamento=${parseInt(redirecionarApto)}, ` : '';
    const query = `update Visitantes set ${setApto}auth_status='pendente', auth_solicitado_em=NOW(),
                     auth_respondido_em=NULL, auth_respondido_por=NULL, liberado=0 where id=${id}`;
    await db.query(query);
  },

  autorizar: async function (id, respondidoPor, darEntrada) {
    const por = Number(respondidoPor) || 'NULL';
    const entradaClause = darEntrada ? ', data_entrada=NOW(), data_saida=NULL' : '';
    const query = `update Visitantes set auth_status='autorizado', liberado=1${entradaClause},
                     auth_respondido_em=NOW(), auth_respondido_por=${por} where id=${id}`;
    await db.query(query);
  },

  negar: async function (id, respondidoPor) {
    const por = Number(respondidoPor) || 'NULL';
    const query = `update Visitantes set auth_status='negado', liberado=0,
                     auth_respondido_em=NOW(), auth_respondido_por=${por} where id=${id}`;
    await db.query(query);
  },

  getPendentesByAptos: async function (idAptos) {
    const list = (idAptos || []).map((x) => parseInt(x)).filter((n) => !isNaN(n));
    if (list.length === 0) return [];
    const query = `select v.id, v.nome, v.doc_identificacao, v.foto_pessoa as photo,
                      v.is_prestador, v.auth_solicitado_em,
                      apto.apto, apto.bloco as apto_bloco, apto.id as apto_id
                    from Visitantes v
                    inner join Apartamentos apto on apto.id=v.id_apartamento
                    where v.auth_status='pendente' and v.id_apartamento in (${list.join(',')})
                    order by v.auth_solicitado_em desc`;
    const { results } = await db.query(query);
    return results;
  },

  getByCode: async function (id_cond, codigo) {
    const query = `select v.id, v.nome, v.doc_identificacao, 
                      DATE_FORMAT(v.data_hora_inicio, '%d/%m/%Y %H:%i') as data_inicio, 
                      DATE_FORMAT(v.data_hora_termino, '%d/%m/%Y %H:%i') as data_termino, 
                      v.data_hora_inicio, v.data_hora_termino,
                      v.data_entrada, v.data_saida, v.is_visitante, v.is_prestador,
                      v.foto_documento, v.foto_pessoa,
                      apto.apto, apto.bloco as apto_bloco, apto.id as apto_id,
                      u.name as morador_nome
                    from Visitantes v
                    inner join Apartamentos apto on apto.id=v.id_apartamento
                    left join Users u on u.id=v.user
                      where v.id_condominio=${id_cond} 
                        and v.codigo_acesso='${codigo}'
                        and v.data_saida is null
                      order by v.data_hora_inicio desc
                      limit 1`;
    const { results } = await db.query(query);
    return results[0];
  }
};
