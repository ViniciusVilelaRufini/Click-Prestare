const db = require('./MySQL.js');

/**
 * Vagas do apartamento. O síndico define a quantidade (Apartamentos.qtd_vagas);
 * o morador libera vagas livres para um visitante cadastrado ou um inquilino do
 * apto, com janela de acesso (inicio/fim). Consultas parametrizadas.
 */
module.exports = {
  /**
   * Resolve o morador logado + o apartamento (com qtd_vagas) no condomínio.
   * Preferimos o vínculo direto em Apartamentos_Users; caso não exista, caímos
   * no match por bloco/apto do registro de Moradores. Retorna null se não achar.
   */
  getMoradorApto: async function (idUser, idCondominio) {
    const mq = `select id, id_condominio, bloco, apartamento
                from Moradores where id_user=? and id_condominio=? limit 1`;
    const { results: mr } = await db.queryParam(mq, [idUser, idCondominio]);
    if (!mr[0]) return null;
    const morador = mr[0];

    let aq = `select a.id, a.qtd_vagas from Apartamentos_Users au
              inner join Apartamentos a on a.id = au.id_apto
              where au.id_user=? and a.id_condominio=? limit 1`;
    let { results: ar } = await db.queryParam(aq, [idUser, idCondominio]);
    if (!ar[0] && morador.bloco != null && morador.apartamento != null) {
      const aq2 = `select id, qtd_vagas from Apartamentos
                   where id_condominio=? and bloco=? and apto=? limit 1`;
      ({ results: ar } = await db.queryParam(aq2, [idCondominio, morador.bloco, morador.apartamento]));
    }
    if (!ar[0]) return null;
    return {
      idMorador: morador.id,
      idApto: ar[0].id,
      qtdVagas: ar[0].qtd_vagas || 0,
      idCondominio: Number(idCondominio),
    };
  },

  getVagasAtivas: async function (idApto) {
    const q = `select vg.id, vg.tipo_ocupacao, vg.id_veiculo, vg.id_visitante,
                 vg.id_morador_beneficiario, vg.placa, vg.inicio, vg.fim,
                 ve.placa as veiculo_placa,
                 vis.nome as visitante_nome,
                 mb.nome as beneficiario_nome,
                 mt.nome as titular_nome
               from Vagas vg
               left join Veiculos ve on ve.id = vg.id_veiculo
               left join Visitantes vis on vis.id = vg.id_visitante
               left join Moradores mb on mb.id = vg.id_morador_beneficiario
               left join Moradores mt on mt.id = vg.id_morador_titular
               where vg.id_apartamento=? and vg.ativo=1
               order by vg.created_at desc`;
    const { results } = await db.queryParam(q, [idApto]);
    return results;
  },

  countAtivas: async function (idApto) {
    const { results } = await db.queryParam(
      `select count(*) as c from Vagas where id_apartamento=? and ativo=1`, [idApto]);
    return results[0] ? results[0].c : 0;
  },

  getVisitantesApto: async function (idApto) {
    const { results } = await db.queryParam(
      `select id, nome, doc_identificacao from Visitantes
       where id_apartamento=? and is_visitante=1 order by nome asc`, [idApto]);
    return results;
  },

  // Inquilinos do apto → Moradores.id (bate com o FK id_morador_beneficiario).
  getInquilinosApto: async function (idApto) {
    const q = `select distinct m.id, m.nome
               from Apartamentos_Users au
               inner join Apartamentos a on a.id = au.id_apto
               inner join Moradores m on m.id_user = au.id_user and m.id_condominio = a.id_condominio
               where au.id_apto=? and lower(trim(au.tipo))='inquilino'
               order by m.nome asc`;
    const { results } = await db.queryParam(q, [idApto]);
    return results;
  },

  getVisitanteApto: async function (id, idApto) {
    const { results } = await db.queryParam(
      `select id from Visitantes where id=? and id_apartamento=? limit 1`, [id, idApto]);
    return results[0];
  },

  getMoradorById: async function (id, idCondominio) {
    const { results } = await db.queryParam(
      `select id from Moradores where id=? and id_condominio=? limit 1`, [id, idCondominio]);
    return results[0];
  },

  // Libera o acesso do visitante na janela informada (coalesce mantém valores existentes).
  liberarVisitanteAcesso: async function (idVisitante, inicio, fim) {
    const q = `update Visitantes set liberado=1,
                 data_hora_inicio=coalesce(?, data_hora_inicio),
                 data_hora_termino=coalesce(?, data_hora_termino)
               where id=?`;
    await db.queryParam(q, [inicio, fim, idVisitante]);
  },

  insertVaga: async function (v) {
    const q = `insert into Vagas
        (id_condominio, id_apartamento, id_morador_titular, tipo_ocupacao,
         id_veiculo, id_visitante, id_morador_beneficiario, placa, inicio, fim)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [
      v.id_condominio, v.id_apartamento, v.id_morador_titular, v.tipo_ocupacao,
      v.id_veiculo || null, v.id_visitante || null, v.id_morador_beneficiario || null,
      v.placa || null, v.inicio || null, v.fim || null,
    ];
    const { results } = await db.queryParam(q, params);
    return results.insertId;
  },

  revogar: async function (id, idApto) {
    const { results } = await db.queryParam(
      `update Vagas set ativo=0 where id=? and id_apartamento=? and ativo=1`, [id, idApto]);
    return results.affectedRows;
  },
};
