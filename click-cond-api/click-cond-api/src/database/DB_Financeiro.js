const db = require('./MySQL.js');

module.exports = {
  insert: async function (id_condominio, financeiro, name) {
    financeiro.nome = financeiro.nome.replaceAll("'","''");
    financeiro.descricao = financeiro.descricao.replaceAll("'","''");
    financeiro.tipo = financeiro.tipo.replaceAll("'","''");

    let id_usuario = financeiro.id_usuario;
    if (!id_usuario && financeiro.nome && financeiro.nome.startsWith('Apto ')) {
      try {
        const regex = /Apto\s+([^\s]+)\s+Bloco\s+([^\s]+)/i;
        const match = financeiro.nome.match(regex);
        if (match) {
          const apto = match[1];
          const bloco = match[2];
          const userRes = await db.query(`select id_user from Moradores where id_condominio=${id_condominio} and apartamento='${apto}' and bloco='${bloco}' limit 1`);
          if (userRes.results && userRes.results.length > 0) {
            id_usuario = userRes.results[0].id_user;
          }
        }
      } catch (err) {
        console.error('Error finding resident user:', err);
      }
    }

    const calculatedPago = financeiro.pago !== undefined && financeiro.pago !== null 
      ? financeiro.pago 
      : ((financeiro.categoria === 'Arrecadação' || (financeiro.nome && financeiro.nome.startsWith('Apto '))) 
        ? 0 
        : (financeiro.data == null || financeiro.data == "" ? 0 : 1));

    const query = `insert into Financeiro (nome, tipo, valor, data, data_vencimento, categoria, conta, descricao, cliente, forma_pagamento, parcelas, nome_operador, id_condominio, photo, pago, url_boleto, status, id_usuario)
						values ('${financeiro.nome}',
                    '${financeiro.tipo}',
                    '${financeiro.valor}',
                    ${financeiro.data != null ? `'${financeiro.data}'` : 'null'},
                    ${financeiro.data_vencimento != null ? `'${financeiro.data_vencimento}'` : 'null'},
                    '${financeiro.categoria}',
                    ${financeiro.conta != null ? `'${financeiro.conta}'` : 'null'},
                    ${financeiro.descricao != null ? `'${financeiro.descricao}'` : null},
                    ${financeiro.cliente != null ? `'${financeiro.cliente}'` : null},
                    ${financeiro.forma_pagamento != null ? `'${financeiro.forma_pagamento}'` : null},
                    ${financeiro.parcelas != null ? `'${financeiro.parcelas}'` : null},
                    '${name}',
                    ${id_condominio},
                    '${financeiro.photo}',
                    ${calculatedPago},
                    ${financeiro.url_boleto != null ? `'${financeiro.url_boleto}'` : 'null'},
                    ${financeiro.status != null ? financeiro.status : 0},
                    ${id_usuario != null ? id_usuario : 'null'}
                  )`;
    await db.query(query);
  },

  getAll: async function (id_cond, mes, ano, getPendentes) {
    const query = `select t1.id, t1.nome, t1.tipo, t1.valor, t1.categoria, t1.nome_operador, t1.pago, t1.status,
                      DATE_FORMAT(COALESCE(t1.data, t1.data_vencimento, t1.created_at), '%d') as dia,
                      DATE_FORMAT(COALESCE(t1.data, t1.data_vencimento, t1.created_at), '%m') as mes,
                      DATE_FORMAT(COALESCE(t1.data, t1.data_vencimento, t1.created_at), '%Y') as ano
                    from Financeiro as t1
                    where t1.id_condominio=${id_cond} 
                      and COALESCE(t1.data, t1.data_vencimento, t1.created_at) <= '${ano}-${mes}-31'
                      and COALESCE(t1.data, t1.data_vencimento, t1.created_at) >= '${ano}-${mes}-01'
                      ${getPendentes == false ? 'and t1.pago=1' : ''}
                    order by COALESCE(t1.data, t1.data_vencimento, t1.created_at) asc, t1.created_at desc`;
    const { results } = await db.query(query);
    return results;
  },

  getAllGrafico: async function (id_cond, mes, ano) {
    const query = `select t1.id, t1.nome, t1.tipo, t1.valor, t1.categoria, t1.pago,
                      DATE_FORMAT(COALESCE(t1.data, t1.data_vencimento, t1.created_at), '%d') as dia,
                      DATE_FORMAT(COALESCE(t1.data, t1.data_vencimento, t1.created_at), '%m') as mes,
                      DATE_FORMAT(COALESCE(t1.data, t1.data_vencimento, t1.created_at), '%Y') as ano
                    from Financeiro as t1
                    where t1.id_condominio=${id_cond} 
                      and COALESCE(t1.data, t1.data_vencimento, t1.created_at) <= '${ano}-${mes}-31' 
                      and COALESCE(t1.data, t1.data_vencimento, t1.created_at) >= '${ano}-${mes}-01' 
                      and t1.pago = 1
                    order by t1.categoria asc`;
    const { results } = await db.query(query);
    return results;
  },

  getAllMoradores: async function (id_cond, mes, ano) {
    const query = `select a.id as apto_id, a.bloco, a.apto, 
                      f.valor, f.id as financeiro_id, DATE_FORMAT(f.data, '%d/%m/%Y') as data, DATE_FORMAT(f.data_vencimento, '%d/%m/%Y') as data_vencimento, f.conta, f.descricao, f.pago
                    from Apartamentos a
                    left join Financeiro f on (f.nome=concat('Apto ',a.apto,' Bloco ', a.bloco, ' - Ref. ', '${mes}', '/', '${ano}') and f.id_condominio=a.id_condominio)
                      where a.id_condominio=${id_cond} 
                    group by a.bloco, a.apto 
                    order by a.bloco, a.apto asc`;
    const { results } = await db.query(query);
    return results;
  },

  getAllInadimplentes: async function (id_cond, meses) {
    const query = `select a.bloco, a.apto, ${meses.length} - count(distinct f.nome) as qtd
                    from Apartamentos a
                    left join Financeiro f on (
                      f.nome in (
                          ${ meses.map(mes =>
                            `concat('Apto ',a.apto,' Bloco ', a.bloco, ' - Ref. ', '${mes.mes}', '/', '${mes.ano}')`
                          )}                       
                        ) 
                      and 
                      f.id_condominio=${id_cond}
                      and f.pago=1
                    )
                      where a.id_condominio=${id_cond}
                    group by a.bloco, a.apto 
                    having count(distinct f.nome)!=${meses.length}`;
                    console.log(query);
    const { results } = await db.query(query);
    return results;
  },

  getInadimplenteDetail: async function (id_cond, meses, apto, bloco) {
    // meses.pop();
    console.log(meses);
    const query = `select a.bloco, a.apto, f.nome
                    from Apartamentos a
                    left join Financeiro f on(
                        f.nome in (
                            ${ meses.map(mes =>
                              `concat('Apto ',a.apto,' Bloco ', a.bloco, ' - Ref. ', '${mes.mes}', '/', '${mes.ano.slice(-2)}')`
                            )}                       
                          ) 
                        and 
                        f.id_condominio=${id_cond}
                      )
                      where a.id_condominio=${id_cond} and a.apto='${apto}' and a.bloco='${bloco}'
                    `;
                    console.log(query);
    const { results } = await db.query(query);
    console.log(results);
    var arr = [];
    meses.forEach(mes => {
      var contains = false;
      results.forEach(result => {
        if(result.nome != null && result.nome.includes(mes.mes+'/'+mes.ano.slice(-2))){
          contains = true;
        }        
      })
      if(!contains){
        arr.push(mes);
      }
    });
    return arr;
  },

  getAllMeses: async function (id_cond) {
    const query = `select 
                      distinct DATE_FORMAT(COALESCE(t1.data, t1.data_vencimento, t1.created_at), '%m/%y') as periodo,
                      DATE_FORMAT(COALESCE(t1.data, t1.data_vencimento, t1.created_at), '%m') as mes,
                      DATE_FORMAT(COALESCE(t1.data, t1.data_vencimento, t1.created_at), '%Y') as ano
                    from Financeiro as t1
                    where t1.id_condominio=${id_cond}
                    order by COALESCE(t1.data, t1.data_vencimento, t1.created_at) asc `;
    const { results } = await db.query(query);
    return results;
  },

  remove: async function (id) {
    const query = `delete from Financeiro where id=${id}`;
    await db.query(query);
  },

  update: async function (id_condominio, financeiro, name) {
    financeiro.nome = financeiro.nome.replaceAll("'","''");
    financeiro.descricao = financeiro.descricao.replaceAll("'","''");
    financeiro.tipo = financeiro.tipo.replaceAll("'","''");

    let id_usuario = financeiro.id_usuario;
    if (!id_usuario && financeiro.nome && financeiro.nome.startsWith('Apto ')) {
      try {
        const regex = /Apto\s+([^\s]+)\s+Bloco\s+([^\s]+)/i;
        const match = financeiro.nome.match(regex);
        if (match) {
          const apto = match[1];
          const bloco = match[2];
          const userRes = await db.query(`select id_user from Moradores where id_condominio=${id_condominio} and apartamento='${apto}' and bloco='${bloco}' limit 1`);
          if (userRes.results && userRes.results.length > 0) {
            id_usuario = userRes.results[0].id_user;
          }
        }
      } catch (err) {
        console.error('Error finding resident user:', err);
      }
    }
    
    const query = `update Financeiro 
                     set nome='${financeiro.nome}',
                      tipo='${financeiro.tipo}',
                      valor='${financeiro.valor}',
                      data=${financeiro.data != null ? `'${financeiro.data}'` : 'null'},
                      data_vencimento=${financeiro.data_vencimento != null ? `'${financeiro.data_vencimento}'` : 'null'},
                      categoria='${financeiro.categoria}',
                      conta=${financeiro.conta != null ? `'${financeiro.conta}'` : 'null'},
                      descricao=${financeiro.descricao != null ? `'${financeiro.descricao}'` : 'null'},
                      cliente=${financeiro.cliente != null ? `'${financeiro.cliente}'` : 'null'},
                      forma_pagamento=${financeiro.forma_pagamento != null ? `'${financeiro.forma_pagamento}'` : 'null'},
                      parcelas=${financeiro.parcelas != null ? `'${financeiro.parcelas}'` : 'null'},
                      nome_operador='${name}',
                      pago=${financeiro.pago !== undefined && financeiro.pago !== null ? financeiro.pago : (financeiro.data == null || financeiro.data == "" ? 0 : 1)},
                      url_boleto=${financeiro.url_boleto != null ? `'${financeiro.url_boleto}'` : 'url_boleto'},
                      url_comprovante=${financeiro.url_comprovante != null ? `'${financeiro.url_comprovante}'` : 'url_comprovante'},
                      status=${financeiro.status != null ? financeiro.status : 'status'},
                      id_usuario=${id_usuario != null ? id_usuario : 'id_usuario'}
                    where id=${financeiro.id} and id_condominio=${id_condominio}`;
    await db.query(query);
  },

  updatePhoto: async function (url, id){
    const query = `update Financeiro set photo='${url}' where id='${id}' `;
    await db.query(query);
  },

  get: async function (id_cond, id) {
    const query = `select id, 
                        nome, 
                        tipo,
                        valor, 
                        DATE_FORMAT(data_vencimento, '%d/%m/%Y') as data_vencimento,
                        DATE_FORMAT(data, '%d/%m/%Y') as data,
                        categoria, 
                        conta,
                        descricao, 
                        cliente,
                        forma_pagamento,
                        parcelas,
                        photo,
                        pago,
                        id_usuario
                      from Financeiro
                      where id_condominio=${id_cond} and id=${id}`;
    const { results } = await db.query(query);
    return results[0];
  },

  getLastUpdate: async function (id_cond) {
    const query = `select DATE_FORMAT(created_at, '%d/%m/%Y') as data
                      from Financeiro
                    where id_condominio=${id_cond}
                    order by id desc limit 1`;
    const { results } = await db.query(query);
    if(results.length == 0){
      return "-";
    }
    return results[0].data;
  },

  updateBoleto: async function (url, id){
    const query = `update Financeiro set url_boleto='${url}' where id='${id}' `;
    await db.query(query);
  },

  updateComprovante: async function (url, id){
    const query = `update Financeiro set url_comprovante='${url}', status=2 where id='${id}' `;
    await db.query(query);
  },

  updateStatus: async function (status, id){
    const query = `update Financeiro set status=${status}, pago=${status == 1 ? 1 : 0} where id='${id}' `;
    await db.query(query);
  },

  getByUser: async function (id_user, id_cond) {
    const query = `select id, nome, tipo, valor, categoria, url_boleto, url_comprovante, status,
                    DATE_FORMAT(data_vencimento, '%d/%m/%Y') as data_vencimento,
                    DATE_FORMAT(data, '%d/%m/%Y') as data, pago
                    from Financeiro
                    where id_condominio=${id_cond} and (id_usuario=${id_user} or id_usuario is null)
                    order by data_vencimento desc`;
    const { results } = await db.query(query);
    return results;
  },
    
};
