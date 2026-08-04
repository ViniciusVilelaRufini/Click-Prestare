const db = require('./MySQL.js');

// Espelho dev do módulo `contatos` do NestJS (agenda de mão de obra do
// condomínio). Usa queryParam (prepared statement) em vez da interpolação
// de string do resto do arquivo legado — não há motivo pra nascer sujeito a
// injeção quando o wrapper já expõe o caminho parametrizado.
module.exports = {
  getAll: async function (id_condominio) {
    const query = `select id, nome, categoria, telefone, observacao, created_at
                     from Contatos_Uteis
                    where id_condominio = ? and ativo = 1
                 order by categoria asc, nome asc`;
    const { results } = await db.queryParam(query, [id_condominio]);
    return results;
  },

  insert: async function (id_condominio, contato) {
    const query = `insert into Contatos_Uteis (id_condominio, nome, categoria, telefone, observacao)
                   values (?, ?, ?, ?, ?)`;
    const { results } = await db.queryParam(query, [
      id_condominio,
      contato.nome,
      contato.categoria,
      contato.telefone,
      contato.observacao || null,
    ]);
    return results.insertId;
  },

  update: async function (id_condominio, contato) {
    const query = `update Contatos_Uteis
                      set nome = ?, categoria = ?, telefone = ?, observacao = ?
                    where id = ? and id_condominio = ?`;
    await db.queryParam(query, [
      contato.nome,
      contato.categoria,
      contato.telefone,
      contato.observacao || null,
      contato.id,
      id_condominio,
    ]);
  },

  remove: async function (id) {
    await db.queryParam('delete from Contatos_Uteis where id = ?', [id]);
  },
};
