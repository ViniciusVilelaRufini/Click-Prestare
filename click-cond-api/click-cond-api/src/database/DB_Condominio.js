const db = require('./MySQL.js');
const doubleToReal = require('../utils/doubleToReal.js');


module.exports = {
  registerAddress: async function (address) {
    address.rua = address.rua.replaceAll("'","''");
    address.complemento = address.complemento.replaceAll("'","''");
    address.bairro = address.bairro.replaceAll("'","''");
    address.cidade = address.cidade.replaceAll("'","''");

    const query = `insert into Endereco (
						cep, rua, numero, complemento, bairro, cidade, uf, pais)
						values ('${address.cep}','${address.rua}','${address.numero}','${address.complemento}',
								'${address.bairro}','${address.cidade}','${address.uf}','${address.pais}')`;
    await db.query(query);
  },

  updateAddress: async function (address) {
    address.rua = address.rua.replaceAll("'","''");
    address.complemento = address.complemento.replaceAll("'","''");
    address.bairro = address.bairro.replaceAll("'","''");
    address.cidade = address.cidade.replaceAll("'","''");

    const query = `update Endereco set 
                     cep='${address.cep}',
                     rua='${address.rua}',
                     numero='${address.numero}',
                     complemento='${address.complemento}',
                     bairro='${address.bairro}',
                     cidade='${address.cidade}',
                     uf='${address.uf}',
                     pais='${address.pais}' 
                    where id=(select endereco from Condominios where id=${address.idCondominio})`;
    await db.query(query);
  },

  registerCondominio: async function (cond) {
    cond.nome = cond.nome.replaceAll("'","''");
    cond.subsindico_nome = cond.subsindico_nome.replaceAll("'","''");

    cond.inicio_mandato = cond.inicio_mandato.split("/");
    cond.inicio_mandato = cond.inicio_mandato[2]+"-"+cond.inicio_mandato[1]+"-"+cond.inicio_mandato[0];
    cond.termino_mandato = cond.termino_mandato.split("/");
    cond.termino_mandato = cond.termino_mandato[2]+"-"+cond.termino_mandato[1]+"-"+cond.termino_mandato[0];
    const query = `insert into Condominios (
						nome, identificacao, subsindico_nome, data_inicio_mandato, data_termino_mandato, num_blocos, num_aptos, vencimento, endereco)
						values ('${cond.nome}','${cond.identificacao}','${cond.subsindico_nome}','${cond.inicio_mandato}','${cond.termino_mandato}',
								'${cond.num_blocos}','${cond.num_aptos}',
                DATE_ADD(NOW(), INTERVAL 45 day),
                (select max(id) from Endereco))`;
    await db.query(query);           
    const result2 = await db.query("select Max(id) as id from Condominios");
    return result2.results[0].id;
  },

  updateCondominio: async function (cond) {
    cond.nome = cond.nome.replaceAll("'","''");
    cond.subsindico_nome = cond.subsindico_nome.replaceAll("'","''");
    
    cond.inicio_mandato = cond.inicio_mandato.split("/");
    cond.inicio_mandato = cond.inicio_mandato[2]+"-"+cond.inicio_mandato[1]+"-"+cond.inicio_mandato[0];
    cond.termino_mandato = cond.termino_mandato.split("/");
    cond.termino_mandato = cond.termino_mandato[2]+"-"+cond.termino_mandato[1]+"-"+cond.termino_mandato[0];
    const query = `update Condominios set 
                     nome='${cond.nome}',
                     identificacao='${cond.identificacao}',
                     subsindico_nome='${cond.subsindico_nome}',
                     data_inicio_mandato='${cond.inicio_mandato}',
                     data_termino_mandato='${cond.termino_mandato}'                   
                    where id=${cond.id}`;
    await db.query(query);
  },

  updateMoeda: async function (cond) {   
    const query = `update Condominios set 
                     moeda='${cond.moeda}'              
                    where id=${cond.id}`;
    await db.query(query);
  },

  vinculaCondominioSindico: async function (userId, condId) {
    const query = `insert into Sindicos_Condominios (id_user, id_condominio)
                  values(${userId},${condId})`;
    await db.query(query);
  },
  
  getCondominio: async function (condominioId) {
    const query = `select c.id, c.photo, c.nome, sum(f.valor) as saldo, c.moeda,
                      (select count(id) from Apartamentos where id_condominio=c.id) as num_aptos,
                      (select coalesce(sum(valor), 0) from Financeiro where id_condominio=c.id and pago=0) as inadimplencia,
                      DATE_FORMAT(c.vencimento, '%d/%m/%Y') as vencimento_condominio,
                      (DATEDIFF(c.vencimento, NOW()) + 1) as dias_restantes_condominio
                    from Condominios c
                    left join Financeiro f on (f.id_condominio=c.id and f.pago=1)
                      where c.id=${condominioId}
                      group by c.id`;
    const { results } = await db.query(query);
    return results[0];                
  },

  getList: async function (userId) {
    var query = `select c.id, c.nome, c.photo, c.num_blocos, c.moeda,
                  (select count(id) from Apartamentos where id_condominio=c.id) as num_aptos
                 from Condominios c 
                  inner join Sindicos_Condominios sc on sc.id_condominio = c.id
                  where sc.id_user=${userId}`;
    const { results } = await db.query(query);
    return results;             
  },

  updateCondominioPhoto: async function (url, id){
    const query = `update Condominios set photo='${url}' where id='${id}' `;
    await db.query(query);
  },

  getAllAptos: async function (id) {
    var query = `select distinct id, bloco, apto
                 from Apartamentos 
                  where id_condominio=${id}`;
    const { results } = await db.query(query);
    return results;             
  },

  getInfos: async function (id) {
    const query = `select nome, identificacao, subsindico_nome, photo,
                    DATE_FORMAT(data_inicio_mandato, '%d/%m/%Y') as data_inicio_mandato,
                    DATE_FORMAT(data_termino_mandato, '%d/%m/%Y') as data_termino_mandato
                  from Condominios
                   where id=${id}`;  
    const { results } = await db.query(query);
    return results[0];
  }, 

  getAddress: async function (idCondominio) {
    const query = `select cep, pais, uf, cidade, bairro, rua, numero, complemento 
                  from Endereco
                  where id=(select endereco from Condominios where id=${idCondominio})`;    
    const { results } = await db.query(query);
    return results[0];
  }, 

  updateVencimentoCondominio: async function (id, plano, vencimento_atual, dias_restantes){
    var query = "";
    if(dias_restantes > 0){
      query = `update Condominios set vencimento=DATE_ADD('${vencimento_atual}', INTERVAL ${plano.dias} DAY) where id='${id}' `;
    } else {
      query = `update Condominios set vencimento=DATE_ADD(NOW(), INTERVAL ${plano.dias} DAY) where id='${id}' `;
    }
    await db.query(query);
  },

  registerAssinatura: async function (id_user, assinatura, plano, vencimento_atual, dias_restantes) {
    const query = `insert into Assinaturas_Condominios(id_condominio, email_user, codigo, data_ini, data_fim, dias, plano, plataforma, valor)
						    values ('${assinatura.id_condominio}',
                        (select login from Users where id=${id_user}),
                        '${assinatura.codigo}',
                        ${dias_restantes > 0 ? `DATE_ADD('${vencimento_atual}', INTERVAL 1 DAY)` : `NOW()`},
								        (select vencimento from Condominios where id=${assinatura.id_condominio}),
                        '${plano.dias}',
                        '${plano.nome}',
                        '${assinatura.plataforma}',
                        ${plano.valor}
                      )`;
                      console.log(query);
    await db.query(query);
  },

  getPlano: async function (id) {
    const query = `select * from Planos where nome='${id}'`;
    const { results } = await db.query(query);
    return results[0];
  },

  getVencimento: async function (id) {
    const query = `select DATE_FORMAT(vencimento, '%Y-%m-%d') as vencimento, (DATEDIFF(vencimento, NOW()) + 1) as dias_restantes from Condominios where id=${id}`;
    const { results } = await db.query(query);
    return results[0];
  },

  remove: async function (id) {
    const query = `update Condominios set ativo=0 where id=${id}`;
    await db.query(query);
  },

};
