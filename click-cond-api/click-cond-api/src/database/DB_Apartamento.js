const db = require('./MySQL.js');

module.exports = {
  insertApto: async function (bloco, apto, fracao, id_condominio) {
    const query = `insert into Apartamentos (bloco, apto, fracao, id_condominio)
                        values ('${bloco}', '${apto}', '${fracao}', '${id_condominio}')`;

    await db.query(query).then((response) => {
      if (response.status == 'Error') {
        if (response.error.sqlMessage.includes('un_apto_cond')) {
          throw new Error('Apartamento já cadastrado!');
        }
        throw new Error('Houve um erro ao realizar o seu cadastro. Por favor, tente novamente!');
      }
    });

    const result2 = await db.query("select Max(id) as id, bloco, apto, fracao from Apartamentos");
    return result2.results[0];
  },

  getAll: async function (id_cond, offset) {
    const query = `select id, bloco, apto, fracao
                    from Apartamentos
                      where id_condominio=${id_cond}`;
    console.log(query);
    const { results } = await db.query(query);
    return results;
  },

  remove: async function (id) {
    const query = `delete from Apartamentos where id=${id}`;
    await db.query(query);
  },

  updateApto: async function (idApto, bloco, apto, fracao) {
    const query = `update Apartamentos set 
                    bloco='${bloco}',
                    apto='${apto}',
                    fracao='${fracao}'                   
                  where id=${idApto}`;

    await db.query(query).then((response) => {
      if (response.status == 'Error') {
        if (response.error.sqlMessage.includes('un_apto_cond')) {
          throw new Error('Apartamento já cadastrado!');
        }
        throw new Error('Houve um erro ao realizar o seu cadastro. Por favor, tente novamente!');
      }
    });

    const result2 = await db.query(`select id, bloco, apto, fracao from Apartamentos where id=${idApto}`);
    return result2.results[0];
  },

  getMoradores: async function (id_apto, tipo) {
    // Fonte canônica = Apartamentos_Users (vínculo real). LEFT JOIN Moradores para o perfil,
    // assim vínculos "órfãos" (sem ficha) ainda aparecem, batendo com a contagem do card/app.
    // Filtro de tipo robusto a acento/caixa e a valores legados ('Proprietário'/'morador'/null).
    const norm = (t) => `lower(trim(convert(${t} using utf8)))`;
    let tipoCond = '';
    if (tipo) {
      const t = String(tipo).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
      if (t === 'inquilino') {
        tipoCond = ` and ${norm('au.tipo')} = 'inquilino'`;
      } else if (t === 'membro') {
        tipoCond = ` and ${norm('au.tipo')} in ('membro','dependente')`;
      } else { // proprietario: inclui legados morador/null/vazio/Proprietário
        tipoCond = ` and (au.tipo is null or trim(au.tipo)='' or ${norm('au.tipo')} in ('proprietario','morador') or ${norm('au.tipo')} like 'propriet%rio')`;
      }
    }
    // ANY_VALUE evita erro de only_full_group_by ao deduplicar por usuário
    // (caso haja mais de um vínculo do mesmo user no apto).
    const query = `select u.id, any_value(u.photo) as photo,
                      any_value(coalesce(m.nome, u.name)) as nome,
                      any_value(coalesce(m.documento, u.cpf)) as documento,
                      any_value(m.data_nascimento) as data_nascimento,
                      any_value(coalesce(m.email, u.email)) as email,
                      any_value(coalesce(m.telefone, u.phone)) as telefone,
                      any_value(m.extra1) as extra1, any_value(m.extra2) as extra2,
                      any_value(m.extra3) as extra3, any_value(m.extra4) as extra4
                    from Apartamentos_Users au
                    inner join Apartamentos a on a.id = au.id_apto
                    inner join Users u on u.id = au.id_user
                    left join Moradores m on m.id_user = au.id_user and m.id_condominio = a.id_condominio
                      where au.id_apto=${Number(id_apto)}${tipoCond}
                    group by u.id`;

    const { results } = await db.query(query);
    return results;
  },

  getApartmentsByUser: async function (userId, idCondominio) {
    const query = `
      SELECT au.id_apto 
      FROM Apartamentos_Users au
      INNER JOIN Apartamentos a ON a.id = au.id_apto
      WHERE au.id_user = ? AND a.id_condominio = ?
    `;
    const { results } = await db.queryParam(query, [userId, idCondominio]);
    return results.map(r => r.id_apto);
  },

};
