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
    const query = `select u.id, u.photo, m.nome, m.documento, m.data_nascimento, m.email, m.telefone,  m.extra1, m.extra2, m.extra3, m.extra4 
                    from Moradores m
                    inner join Users u on m.id_user = u.id
                    inner join Apartamentos_Users au on au.id_user = u.id
                    inner join Apartamentos a on a.id = au.id_apto
                      where au.tipo='${tipo}' and au.id_apto=${id_apto} and m.id_condominio = a.id_condominio`;

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
