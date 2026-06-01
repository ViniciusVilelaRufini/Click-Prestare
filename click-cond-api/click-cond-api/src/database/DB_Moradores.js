const db = require('./MySQL.js');

module.exports = {
  login: async function (login, password) {
    const query = `select u.id, s.nome, u.photo, u.password                           
                    from Moradores s 
                    inner join Users u on u.id = s.id_user
                    where u.login=?`;
    const result = await db.queryParam(query, [login]);
    if (!result.results || result.results.length === 0) {
      throw new Error('Login ou Senha incorretos');
    }
    
    const user = result.results[0];
    const bcrypt = require('bcrypt');
    const crypto = require('crypto');
    const md5Password = crypto.createHash('md5').update(password).digest("hex");
    
    let isMatch = false;
    if (user.password && user.password.startsWith('$2')) {
      isMatch = await bcrypt.compare(password, user.password);
    } else {
      isMatch = (user.password === md5Password);
      if (isMatch) {
        const newHash = await bcrypt.hash(password, 10);
        await db.queryParam(`UPDATE Users SET password=? WHERE id=?`, [newHash, user.id]);
      }
    }

    if (!isMatch) {
      throw new Error('Login ou Senha incorretos');
    }

    delete user.password;
    return user;
  },

  internalLogin: async function (login) {
    const query = `select u.id, s.nome, u.photo                           
                    from Moradores s 
                    inner join Users u on u.id = s.id_user
                    where u.login='${login}'`;
    const result = await db.query(query);
    return result.results[0];
  },

  insertUser: async function(email, password){
    const query = `insert into Users (login, password, is_morador)
                        values ('${email}',  MD5('${password}'), 1)`;

    await db.query(query).then((response) => {  
      if(response.status == 'Error'){
        if (response.error.sqlMessage.includes('user_login')) {
          throw new Error('E-mail já cadastrado!');
        }
        throw new Error('Houve um erro ao realizar o seu cadastro. Por favor, tente novamente!');
      }
    });  

    const result2 = await db.query(`select id from Users where login='${email}'`);
    return result2.results[0].id;
  },

  insertMorador: async function (nome, email, telefone, data_nascimento, documento, tipo, id_apto, idUser, extra1, extra2, extra3, extra4, idCondominio) {
    let dt = null;
    if (data_nascimento && data_nascimento.includes("/")) {
      const parts = data_nascimento.split("/");
      dt = parts[2]+"-"+parts[1]+"-"+parts[0];
    } else if (data_nascimento && data_nascimento.includes("-")) {
      dt = data_nascimento;
    }

    nome = nome.replaceAll("'","''");
    extra1 = extra1.replaceAll("'","''");
    extra2 = extra2.replaceAll("'","''");
    extra3 = extra3.replaceAll("'","''");
    extra4 = extra4.replaceAll("'","''");

    const aptoInfo = await db.query(`select bloco, apto from Apartamentos where id=${id_apto}`);
    const bloco = aptoInfo.results[0]?.bloco || '';
    const apartamento = aptoInfo.results[0]?.apto || '';

    const query = `insert into Moradores (
            nome, documento, email, telefone, data_nascimento, id_user, id_condominio, bloco, apartamento, extra1, extra2, extra3, extra4)
            values ('${nome}','${documento}','${email}','${telefone}', ${dt ? `'${dt}'` : 'NULL'}, '${idUser}', '${idCondominio}', '${bloco}', '${apartamento}', 
                  '${extra1 ?? ''}', '${extra2 ?? ''}', '${extra3 ?? ''}', '${extra4 ?? ''}'
                  )`;
    await db.query(query);

    const queryIdUser = `select id from Users where login='${email}'`;
    const { results } = await db.query(queryIdUser);
    
    const query2 = `insert into Apartamentos_Users (id_apto, id_user, tipo, vencimento)
      values (${id_apto},${results[0].id},'${tipo}', DATE_ADD(NOW(), INTERVAL 45 day))`;
    await db.query(query2);
  },

  getAll: async function (id_cond, offset) {
    const query = `select u.id, u.photo, m.nome, m.tipo, m.bloco, m.apartamento
                    from Moradores m
                      inner join Users u on m.id_user = u.id
                      where m.id_condominio=${id_cond}
                    order by u.created_at desc`;
                    console.log(query);
    const { results } = await db.query(query);
    return results;
  },

  remove: async function (id) {
    const query = `delete from Users where id=${id}`;
    console.log(query);
    await db.query(query);
  },

  updateMorador: async function (nome, documento, email, telefone, data_nascimento, extra1, extra2, extra3, extra4, idUser) {
    let dt = null;
    if (data_nascimento && data_nascimento.includes("/")) {
      const parts = data_nascimento.split("/");
      dt = parts[2]+"-"+parts[1]+"-"+parts[0];
    } else if (data_nascimento && data_nascimento.includes("-")) {
      dt = data_nascimento;
    }

    nome = nome.replaceAll("'","''");
    extra1 = extra1.replaceAll("'","''");
    extra2 = extra2.replaceAll("'","''");
    extra3 = extra3.replaceAll("'","''");
    extra4 = extra4.replaceAll("'","''");

    const query = `update Moradores set 
                    nome='${nome}',
                    documento='${documento}',
                    email='${email}',
                    telefone='${telefone}',
                    data_nascimento=${dt ? `'${dt}'` : 'NULL'},                  
                    extra1='${extra1 ?? ''}',
                    extra2='${extra2 ?? ''}',
                    extra3='${extra3 ?? ''}',
                    extra4='${extra4 ?? ''}'
                  where id_user=${idUser}`;
                  console.log(query);
    await db.query(query);
  },
    
  get: async function (id, idCondominio) {
    let query = `select u.id, u.photo, m.nome, m.documento, m.email, m.telefone, m.extra1, m.extra2, m.extra3, m.extra4,
                    DATE_FORMAT(data_nascimento, '%d/%m/%Y') as data_nascimento
                    from Moradores m
                      inner join Users u on m.id_user = u.id
                      where u.id=${id}`;
    
    // 1. Se idCondominio for fornecido e válido, tenta buscar dele
    if (idCondominio && parseInt(idCondominio) > 0) {
      const queryCondo = query + ` and m.id_condominio=${idCondominio}`;
      const { results } = await db.query(queryCondo);
      if (results && results.length > 0) {
        return results[0];
      }
    }

    // 2. Busca de algum condomínio ao qual o usuário está de fato vinculado através de um apartamento ativo
    const queryActiveCondo = `select u.id, u.photo, m.nome, m.documento, m.email, m.telefone, m.extra1, m.extra2, m.extra3, m.extra4,
                    DATE_FORMAT(data_nascimento, '%d/%m/%Y') as data_nascimento
                    from Moradores m
                      inner join Users u on m.id_user = u.id
                      inner join Apartamentos_Users au on au.id_user = u.id
                      inner join Apartamentos apto on au.id_apto = apto.id and apto.id_condominio = m.id_condominio
                      inner join Condominios c on apto.id_condominio = c.id
                      where u.id=${id} and c.ativo=1
                      order by m.id desc`;
    const { results: activeResults } = await db.query(queryActiveCondo);
    if (activeResults && activeResults.length > 0) {
      return activeResults[0];
    }

    // 3. Fallback absoluto caso não ache nenhum vínculo ativo
    const { results } = await db.query(query);
    return results[0];
  },

  updateProfilePhoto: async function (url, id){
    const query = `update Users set photo='${url}' where id='${id}' `;
    await db.query(query);
  },

  updateUserLogin: async function (email, id){
    const query = `update Users set login='${email}' where id='${id}' `;
    console.log(query);
    await db.query(query);
  },

  listCondominios: async function (id) {
    const query = `select c.id, c.num_aptos, c.num_blocos, c.moeda,
                    DATE_FORMAT(c.updated_at, '%d/%m/%Y às %H:%i') as updatedAt, 
                    c.nome, c.photo, 
                    (SELECT SUM(valor) FROM Financeiro WHERE id_condominio = c.id AND pago = 1) as saldo,
                    (SELECT DATE_FORMAT(created_at, '%d/%m/%Y') FROM Financeiro WHERE id_condominio = c.id ORDER BY id DESC LIMIT 1) as data_financeiro,
                    DATE_FORMAT(c.vencimento, '%d/%m/%Y') as vencimento_condominio,
                    (DATEDIFF(c.vencimento, NOW()) + 1) as dias_restantes_condominio,
                    apto.id as apto_id, apto.apto as apto, apto.bloco as apto_bloco,
                    DATE_FORMAT(au.vencimento, '%d/%m/%Y') as vencimento_morador,
                    (DATEDIFF(au.vencimento, NOW()) + 1) as dias_restantes_morador
                    from Apartamentos_Users au 
                      inner join Apartamentos apto on apto.id=au.id_apto
                      inner join Condominios c on apto.id_condominio = c.id
                      where au.id_user=${id} and c.ativo=1
                    order by c.created_at desc`;
    const { results } = await db.query(query);
    return results;
  },

  updateVencimentoMorador: async function (id, plano, vencimento_atual, dias_restantes){
    var query = "";
    if(dias_restantes > 0){
      query = `update Apartamentos_Users set vencimento=DATE_ADD('${vencimento_atual}', INTERVAL ${plano.dias} DAY) where id_user='${id}' `;
    } else {
      query = `update Apartamentos_Users set vencimento=DATE_ADD(NOW(), INTERVAL ${plano.dias} DAY) where id_user='${id}' `;
    }
    await db.query(query);
  },

  registerAssinatura: async function (id_user, assinatura, plano, vencimento_atual, dias_restantes) {
    const query = `insert into Assinaturas_Moradores(id_user, email_user, codigo, data_ini, data_fim, dias, plano, plataforma, valor)
						    values ('${id_user}',
                        (select login from Users where id=${id_user}),
                        '${assinatura.codigo}',
                        ${dias_restantes > 0 ? `DATE_ADD('${vencimento_atual}', INTERVAL 1 DAY)` : `NOW()`},
								        (select vencimento from Apartamentos_Users where id_user=${id_user}),
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
    const query = `select 
                      DATE_FORMAT(vencimento, '%Y-%m-%d') as vencimento, 
                      DATE_FORMAT(vencimento, '%d/%m/%Y') as vencimento_formatado,
                      (DATEDIFF(vencimento, NOW()) + 1) as dias_restantes 
                    from Apartamentos_Users where id_user=${id}`;
    const { results } = await db.query(query);
    return results[0];
  },

  getTokensForComunicados: async function (idCondominio) {
    const query = `SELECT fcm_token FROM Users u
                   INNER JOIN Moradores m ON m.id_user = u.id
                   WHERE m.id_condominio = ${idCondominio} 
                   AND u.fcm_token IS NOT NULL 
                   AND u.notif_comunicados = 1`;
    const { results } = await db.query(query);
    return results.map(r => r.fcm_token);
  },

  getTokensForOcorrencias: async function (idUser) {
    const query = `SELECT fcm_token FROM Users
                   WHERE id = ${idUser} 
                   AND fcm_token IS NOT NULL 
                   AND notif_ocorrencias = 1`;
    const { results } = await db.query(query);
    return results.map(r => r.fcm_token);
  },

};
