const db = require('./MySQL.js');
const doubleToReal = require('../utils/doubleToReal.js');


module.exports = {
  insert: async function (id_condominio, document) {
    document.nome = document.nome.replaceAll("'","''");

    const query = `insert into Documentos (id_condominio, is_ata, nome, link_doc)
						values ('${id_condominio}',${document.is_ata},'${document.nome}','${document.link_doc}')`;
    const result = await db.query(query);
    return result.results.insertId;
  },

  getAll: async function (id_cond, is_ata) {
    const query = `select id, nome, link_doc from Documentos
                      where id_condominio=${id_cond} and is_ata=${is_ata}
                    order by created_at desc`;
                    
    const { results } = await db.query(query);
    return results;
  },

  remove: async function (id) {
    const query = `delete from Documentos where id=${id}`;
    await db.query(query);
  },
    
};
