const db = require('./MySQL.js');

module.exports = {
  insert: async function (id_condominio, prestador) {
    prestador.nome = prestador.nome.replaceAll("'","''");
    // id_apartamento: inteiro ou NULL (unidade de destino do prestador).
    const idApto = prestador.id_apartamento ? parseInt(prestador.id_apartamento, 10) : null;

    const query = `insert into Prestadores_servico (nome, telefone, categorias, id_condominio, id_apartamento)
						values ('${prestador.nome}','${prestador.telefone}', '${prestador.categorias}', ${id_condominio}, ${idApto ?? 'NULL'})`;

    await db.query(query);
  },

  getAll: async function (id_cond, offset) {
    const query = `select p.id, p.nome, p.telefone, p.categorias, p.id_apartamento,
                          a.bloco as apto_bloco, a.apto
                     from Prestadores_servico p
                     left join Apartamentos a on a.id = p.id_apartamento
                      where p.id_condominio=${id_cond}
                    order by p.created_at desc`;
    const { results } = await db.query(query);
    return results;
  },

  remove: async function (id) {
    const query = `delete from Prestadores_servico where id=${id}`;
    await db.query(query);
  },

  update: async function (id_condominio, prestador) {
    prestador.nome = prestador.nome.replaceAll("'","''");
    // Só atualiza a unidade quando vier um valor (não apaga em edição sem o campo).
    const idApto = prestador.id_apartamento ? parseInt(prestador.id_apartamento, 10) : null;
    const setApto = idApto ? `, id_apartamento=${idApto}` : '';

    const query = `update Prestadores_servico
                     set nome='${prestador.nome}',
                     telefone='${prestador.telefone}',
                     categorias='${prestador.categorias}'${setApto}
                    where id=${prestador.id} and id_condominio=${id_condominio}`;

    await db.query(query);
  },

  get: async function (id_cond, id) {
    const query = `select p.id, p.nome, p.telefone, p.categorias, p.id_apartamento,
                          a.bloco as apto_bloco, a.apto
                     from Prestadores_servico p
                     left join Apartamentos a on a.id = p.id_apartamento
                      where p.id_condominio=${id_cond} and p.id=${id}`;
    const { results } = await db.query(query);
    return results[0];
  },
};
