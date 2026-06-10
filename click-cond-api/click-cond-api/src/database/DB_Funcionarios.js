const db = require('./MySQL.js');
const bcrypt = require('bcrypt');

module.exports = {
  login: async function (login, password) {
    const query = `select u.id, f.nome, u.photo, 
                      f.areas_sociais, f.comunicados, f.ocorrencias, f.manutencoes_programadas, f.prestadores_servico, 
                      f.agendar_mudanca, f.cadastrar_visitante, f.apartamentos                           
                    from Funcionarios f 
                    inner join Users u on u.id = f.id_user
                    where u.login='${login}' and password=MD5('${password}')`;

    const result = await db.query(query);
    if (!result.results[0]) {
      throw new Error('Login ou Senha incorretos');
    }
    return result.results[0];
  },

  internalLogin: async function (login, password) {
    const query = `select u.id, f.nome, u.photo, 
                      f.areas_sociais, f.comunicados, f.ocorrencias, f.manutencoes_programadas, f.prestadores_servico, 
                      f.agendar_mudanca, f.cadastrar_visitante, f.apartamentos                           
                    from Funcionarios f 
                    inner join Users u on u.id = f.id_user
                    where u.login='${login}'`;

    const result = await db.query(query);
    if (!result.results[0]) {
      throw new Error('Login ou Senha incorretos');
    }
    return result.results[0];
  },

  insertUser: async function(email, password, photo){
    const query = `insert into Users (login, password, is_funcionario)
                        values ('${email}',  MD5('${password}'), 1)`;

    const response = await db.query(query);
    
    if(response.status == 'Error'){
      if (response.error.sqlMessage && response.error.sqlMessage.includes('user_login')) {
        throw new Error('E-mail já cadastrado!');
      }
      throw new Error('Houve um erro ao realizar o seu cadastro. Por favor, tente novamente!');
    }

    return response.results.insertId;
  },

  insertFuncionario: async function (nome, documento, email, telefone, funcao, ch, extra1, extra2, idUser, idCondominio) {
    nome = nome.replaceAll("'","''");
    funcao = funcao.replaceAll("'","''");
    extra1 = extra1.replaceAll("'","''");
    extra2 = extra2.replaceAll("'","''");

    const query = `insert into Funcionarios (
            nome, documento, email, telefone, funcao, ch, id_user, id_condominio, extra1, extra2,
            areas_sociais, comunicados, ocorrencias, manutencoes_programadas, prestadores_servico, 
            agendar_mudanca, cadastrar_visitante, apartamentos)
            values ('${nome}','${documento}','${email}','${telefone}','${funcao}', '${ch}', '${idUser}', '${idCondominio}', '${extra1 ?? ''}', '${extra2 ?? ''}',
            0, 0, 0, 0, 0, 0, 0, 0)`;
    await db.query(query);
  },

  insertPortariaAccess: async function(nome, login, password, email, telefone, idCondominio) {
    let query = '';
    let params = [];
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      query = `INSERT INTO Funcionarios_Portaria (nome, login, password, email, telefone, id_condominio, ativo)
                     VALUES (?, ?, ?, ?, ?, ?, 1)
                     ON DUPLICATE KEY UPDATE password=?, nome=?, ativo=1`;
      params = [nome, login, hash, email, telefone, idCondominio, hash, nome];
    } else {
      query = `INSERT INTO Funcionarios_Portaria (nome, login, email, telefone, id_condominio, ativo)
                     VALUES (?, ?, ?, ?, ?, 1)
                     ON DUPLICATE KEY UPDATE nome=?, ativo=1`;
      params = [nome, login, email, telefone, idCondominio, nome];
    }
    await db.queryParam(query, params);
  },

  removePortariaAccess: async function(login, idCondominio) {
    const query = `DELETE FROM Funcionarios_Portaria WHERE login=? and id_condominio=?`;
    await db.queryParam(query, [login, idCondominio]);
  },

  getAll: async function (id_cond, offset) {
    // Main employees from Funcionarios table
    // Also include portaria-only employees (those not in Funcionarios but in Funcionarios_Portaria)
    const query = `
      SELECT u.id, 
             CONVERT(u.photo USING utf8mb4) COLLATE utf8mb4_unicode_ci as photo, 
             CONVERT(f.nome USING utf8mb4) COLLATE utf8mb4_unicode_ci as nome, 
             CONVERT(f.ch USING utf8mb4) COLLATE utf8mb4_unicode_ci as ch, 
             CONVERT(f.funcao USING utf8mb4) COLLATE utf8mb4_unicode_ci as funcao
      FROM Funcionarios f
        INNER JOIN Users u ON f.id_user = u.id
        WHERE f.id_condominio = ${id_cond}
      UNION
      SELECT NULL as id, NULL as photo, fp.nome, NULL as ch, 'Portaria' as funcao
      FROM Funcionarios_Portaria fp
      WHERE fp.id_condominio = ${id_cond}
        AND fp.ativo = 1
        AND fp.login NOT IN (
          SELECT CONVERT(u2.login USING utf8mb4) COLLATE utf8mb4_unicode_ci 
          FROM Funcionarios f2 INNER JOIN Users u2 ON u2.id = f2.id_user 
          WHERE f2.id_condominio = ${id_cond}
        )
      ORDER BY nome ASC
    `;
    const { results } = await db.query(query);
    return results;
  },

  remove: async function (id) {
    const query = `delete from Users where id=${id}`;
    console.log(query);
    await db.query(query);
  },

  updateFuncionario: async function (nome, documento, email, telefone, funcao, ch, extra1, extra2, userId) {
    nome = nome.replaceAll("'","''");
    funcao = funcao.replaceAll("'","''");
    extra1 = extra1.replaceAll("'","''");
    extra2 = extra2.replaceAll("'","''");

    const query = `update Funcionarios set 
                    nome='${nome}',
                    documento='${documento}',
                    email='${email}',
                    telefone='${telefone}',
                    funcao='${funcao}',
                    ch='${ch}',
                    extra1='${extra1 ?? ''}',
                    extra2='${extra2 ?? ''}'
                  where id_user=${userId}`;
    await db.query(query);
  },

  updateFuncionarioInfos: async function (nome, documento, email, telefone, userId) {
    nome = nome.replaceAll("'","''");

    const query = `update Funcionarios set 
                    nome='${nome}',
                    documento='${documento}',
                    email='${email}',
                    telefone='${telefone}'                   
                  where id_user=${userId}`;
    await db.query(query);
  },
    
  get: async function (id) {
    const query = `select u.id, u.photo, f.nome, f.documento, f.email, f.telefone, f.funcao, f.ch,
                    f.areas_sociais, f.comunicados, f.ocorrencias, f.manutencoes_programadas, f.prestadores_servico, 
                    f.agendar_mudanca, f.cadastrar_visitante, f.apartamentos,
                    f.extra1, f.extra2, f.id_condominio
                    from Funcionarios f
                      inner join Users u on f.id_user = u.id
                      where u.id=${id}`;
    const { results } = await db.query(query);
    const obj = results[0];
    if (obj && obj.email) {
      const portariaCheck = await db.query(`SELECT id FROM Funcionarios_Portaria WHERE login='${obj.email}' AND id_condominio=${obj.id_condominio}`);
      obj.hasPortariaAccess = portariaCheck.results && portariaCheck.results.length > 0;
    }
    return obj;
  },

  updateProfilePhoto: async function (url, id){
    const query = `update Users set photo='${url}' where id='${id}' `;
    await db.query(query);
  },

  updateUserLogin: async function (email, id){
    const query = `update Users set login='${email}', email='${email}' where id='${id}' `;
    console.log(query);
    await db.query(query);
  },

  listCondominios: async function (id) {
    const query = `select c.id, c.num_blocos, c.moeda,
                  (select count(id) from Apartamentos where id_condominio=c.id) as num_aptos,
                  DATE_FORMAT(c.updated_at, '%d/%m/%Y às %H:%i') as updatedAt, 
                  c.nome, c.photo, sum(f.valor) as saldo,
                  DATE_FORMAT(c.vencimento, '%d/%m/%Y') as vencimento_condominio,
                  (DATEDIFF(c.vencimento, NOW()) + 1) as dias_restantes_condominio
                  from Funcionarios func
                    inner join Condominios c on func.id_condominio = c.id
                    left join Financeiro f on (f.id_condominio=c.id and f.pago=1)
                    where func.id_user=${id} and c.ativo=1
                  group by c.id
                  order by c.created_at desc`;
      
                  console.log(query);
    const { results } = await db.query(query);
    return results;
  },

  updatePermissoes: async function (permissoes, id){
    if(permissoes == null || permissoes == undefined){return;}
    const query = `update Funcionarios set 
                    areas_sociais=${permissoes.includes('areas_sociais')},
                    comunicados=${permissoes.includes('comunicados')},
                    ocorrencias=${permissoes.includes('ocorrencias')},
                    manutencoes_programadas=${permissoes.includes('manutencoes_programadas')},
                    prestadores_servico=${permissoes.includes('prestadores_servico')},
                    agendar_mudanca=${permissoes.includes('agendar_mudanca')},
                    cadastrar_visitante=${permissoes.includes('cadastrar_visitante')},
                    apartamentos=${permissoes.includes('apartamentos')}
                    where id_user='${id}' `;
    console.log(query);
    await db.query(query);
  },
};
