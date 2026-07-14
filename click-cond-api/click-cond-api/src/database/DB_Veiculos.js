const db = require('./MySQL.js');

/**
 * Veículos do morador. O vínculo com tag (id_tag) é gerenciado pela portaria
 * (web/NestJS); aqui o app só lê a tag vinculada (join Tags) e faz o CRUD dos
 * dados do carro (placa/cor/marca_modelo). Consultas parametrizadas.
 */
module.exports = {
  /**
   * Resolve o Moradores.id do usuário logado nesse condomínio.
   * Retorna null se o usuário não for morador do condomínio.
   */
  getMoradorId: async function (idUser, idCondominio) {
    const query = `select id from Moradores where id_user=? and id_condominio=? limit 1`;
    const { results } = await db.queryParam(query, [idUser, idCondominio]);
    return results[0] ? results[0].id : null;
  },

  getAllByMorador: async function (idMorador) {
    const query = `select v.id, v.placa, v.cor, v.marca_modelo, v.id_tag, v.id_condominio,
                     t.codigo as tag_codigo, t.tipo as tag_tipo
                   from Veiculos v
                   left join Tags t on t.id = v.id_tag
                   where v.id_morador=? and v.ativo=1
                   order by v.created_at desc`;
    const { results } = await db.queryParam(query, [idMorador]);
    return results;
  },

  getById: async function (id) {
    const query = `select * from Veiculos where id=? limit 1`;
    const { results } = await db.queryParam(query, [id]);
    return results[0];
  },

  insert: async function (veiculo) {
    const query = `insert into Veiculos (id_morador, id_condominio, placa, cor, marca_modelo)
                   values (?, ?, ?, ?, ?)`;
    const params = [
      veiculo.id_morador,
      veiculo.id_condominio,
      (veiculo.placa || '').toUpperCase().trim(),
      veiculo.cor || null,
      veiculo.marca_modelo || null,
    ];
    const { results } = await db.queryParam(query, params);
    return results.insertId;
  },

  /**
   * Atualiza só os dados do carro (não mexe em id_tag — vínculo é da portaria).
   * Escopado ao id_morador para evitar editar carro de outro morador.
   */
  update: async function (veiculo, idMorador) {
    const query = `update Veiculos set placa=?, cor=?, marca_modelo=?
                   where id=? and id_morador=?`;
    const params = [
      (veiculo.placa || '').toUpperCase().trim(),
      veiculo.cor || null,
      veiculo.marca_modelo || null,
      veiculo.id,
      idMorador,
    ];
    await db.queryParam(query, params);
  },

  remove: async function (id, idMorador) {
    const query = `delete from Veiculos where id=? and id_morador=?`;
    await db.queryParam(query, [id, idMorador]);
  },
};
