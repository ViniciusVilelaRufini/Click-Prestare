const db = require('./MySQL.js');

module.exports = {
  insert: async function (id_condominio, area) {
    area.nome = area.nome.replaceAll("'","''");
    const query = `insert into Areas_Sociais (nome, imagem, precisa_agendar, precisa_autorizacao, precisa_pagamento, id_condominio, horarios, capacidade)
						values ('${area.nome}','${area.imagem}','${area.agendar}','${area.autorizacao}', '${area.pagar}', ${id_condominio}, '${JSON.stringify(area.horarios)}', ${area.capacidade})`;
    await db.query(query);
  },

  getAll: async function (id_cond, offset) {
    const query = `select id, nome, imagem from Areas_Sociais
                      where id_condominio=${id_cond}
                    order by created_at desc`;
    const { results } = await db.query(query);
    return results;
  },

  remove: async function (id) {
    const query = `delete from Areas_Sociais where id=${id}`;
    await db.query(query);
  },

  update: async function (id_condominio, area) {
    area.nome = area.nome.replaceAll("'","''");
    const query = `update Areas_Sociais 
                     set nome='${area.nome}',
                     imagem='${area.imagem}',
                     precisa_agendar='${area.agendar}',
                     precisa_autorizacao='${area.autorizacao}',
                     precisa_pagamento='${area.pagar}',
                     horarios='${JSON.stringify(area.horarios)}',
                     capacidade=${area.capacidade}
                    where id=${area.id} and id_condominio=${id_condominio}`;
    await db.query(query);
  },

  get: async function (id_cond, id) {
    const condFilter = id_cond ? `id_condominio=${id_cond} and` : '';
    const query = `select id, nome, imagem, precisa_agendar, precisa_autorizacao, precisa_pagamento, horarios, capacidade, id_condominio from Areas_Sociais
                      where ${condFilter} id=${id}`;
    const { results } = await db.query(query);
    return results[0];
  },

  insertAgendamento: async function (agendamento, userId) {
    // Convert DD/MM/YYYY to YYYY-MM-DD for MySQL DATE column
    let dataFormatted = agendamento.data;
    if (agendamento.data && agendamento.data.includes('/')) {
      const parts = agendamento.data.split('/');
      dataFormatted = `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
    // Ensure hora_de and hora_ate are in HH:MM:SS format
    const horaDeFormatted = agendamento.horaDe && agendamento.horaDe.length === 5 ? `${agendamento.horaDe}:00` : agendamento.horaDe;
    const horaAteFormatted = agendamento.horaAte && agendamento.horaAte.length === 5 ? `${agendamento.horaAte}:00` : agendamento.horaAte;

    const query = `insert into Areas_Sociais_Agendamentos (id_area_social, id_user, id_apartamento, data, hora_de, hora_ate)
				values ('${agendamento.id_area_social}','${userId}','${agendamento.id_apartamento}','${dataFormatted}','${horaDeFormatted}','${horaAteFormatted}')`;
    await db.query(query);
  },

  updateAgendamento: async function (agendamento) {
    const query = `update Areas_Sociais_Agendamentos 
                     set data='${agendamento.data}',
                     hora='${agendamento.hora}'                    
                    where id=${agendamento.id}`;
    await db.query(query);
  },

  removeAgendamento: async function (id) {
    const query = `delete from Areas_Sociais_Agendamentos where id=${id}`;
    await db.query(query);
  },

  getAgendamento: async function (id) {
    const query = `select * from Areas_Sociais_Agendamentos where id=${id}`;
    const { results } = await db.query(query);
    return results[0];
  },

  getAllAgendamentos: async function (id_cond) {
    const query = `select areas.nome nomeArea, ag.status, apto.bloco, apto.apto, 
                    DATE_FORMAT(ag.created_at, '%d/%m/%Y às %H:%i') as data_criacao,
                    DATE_FORMAT(ag.data, '%d/%m/%Y') as data,              
                    DATE_FORMAT(ag.hora_de, '%H:%i') as horaDe,
                    DATE_FORMAT(ag.hora_ate, '%H:%i') as horaAte
                      from Areas_Sociais areas 
                        inner join Areas_Sociais_Agendamentos ag on areas.id=ag.id_area_social
                        inner join Apartamentos apto on apto.id = ag.id_apartamento
                    where areas.id_condominio=${id_cond} and ag.data>DATE_SUB(NOW(), INTERVAL 1 DAY)
                    order by ag.data desc`;
    const { results } = await db.query(query);
    return results;
  },

  getAllMeusAgendamentos: async function (id_cond, id_apto) {
    const aptoFilter = (id_apto && id_apto !== 'null' && id_apto !== 'undefined' && id_apto !== '') 
      ? `and ag.id_apartamento=${id_apto}` 
      : '';
    const query = `select areas.nome nomeArea, ag.status, apto.bloco, apto.apto, 
                    DATE_FORMAT(ag.created_at, '%d/%m/%Y às %H:%i') as data_criacao,
                    DATE_FORMAT(ag.data, '%d/%m/%Y') as data,              
                    DATE_FORMAT(ag.hora_de, '%H:%i') as horaDe,
                    DATE_FORMAT(ag.hora_ate, '%H:%i') as horaAte
                      from Areas_Sociais areas 
                        inner join Areas_Sociais_Agendamentos ag on areas.id=ag.id_area_social
                        inner join Apartamentos apto on apto.id = ag.id_apartamento
                    where areas.id_condominio=${id_cond} ${aptoFilter} and ag.data>DATE_SUB(NOW(), INTERVAL 1 DAY)
                    order by ag.created_at desc`;
    const { results } = await db.query(query);
    return results;
  },

  getAgendamentosFromArea: async function (id_area) {
    const query = `select ag.id, apto.bloco, apto.apto, 
                  DATE_FORMAT(ag.data, '%d/%m/%Y') as data,              
                  DATE_FORMAT(ag.hora_de, '%H:%i') as horaDe,
                  DATE_FORMAT(ag.hora_ate, '%H:%i') as horaAte
                  from Areas_Sociais_Agendamentos ag 
                      left join Apartamentos apto on apto.id = ag.id_apartamento
                    where ag.id_area_social=${id_area} and ag.data>DATE_SUB(NOW(), INTERVAL 1 DAY)
                    order by ag.data, ag.hora_de`;

    const { results } = await db.query(query);
    return results;
  },

  getManutencoesFromArea: async function (id_area) {
    const query = `select id, descricao,
                  DATE_FORMAT(data_inicio, '%d/%m/%Y') as data_inicio,              
                  DATE_FORMAT(hora_inicio, '%H:%i') as hora_inicio,
                  DATE_FORMAT(data_termino, '%d/%m/%Y') as data_termino,              
                  DATE_FORMAT(hora_termino, '%H:%i') as hora_termino
                    from Areas_Sociais_Manutencoes 
                    where id_area_social=${id_area}
                    order by created_at desc`;

    const { results } = await db.query(query);
    return results;
  },

  insertManutencao: async function (manutencao) {
    const query = `insert into Areas_Sociais_Manutencoes (id_area_social, descricao, data_inicio, hora_inicio, data_termino, hora_termino)
						values ('${manutencao.id_area_social}','${manutencao.descricao}','${manutencao.data_inicio}','${manutencao.hora_inicio}',
                  '${manutencao.data_termino}','${manutencao.hora_termino}')`;
    await db.query(query);
  },

  updateManutencao: async function (manutencao) {
    const query = `update Areas_Sociais_Manutencoes 
                     set descricao='${manutencao.descricao}',
                     data_inicio='${manutencao.data_inicio}',
                     hora_inicio='${manutencao.hora_inicio}',
                     data_termino='${manutencao.data_termino}',
                     hora_termino='${manutencao.hora_termino}'
                    where id=${manutencao.id}`;
    await db.query(query);
  },

  removeManutencao: async function (id) {
    const query = `delete from Areas_Sociais_Manutencoes where id=${id}`;
    await db.query(query);
  },

  updateStatusAgendamento: async function (id, status) {
    const query = `update Areas_Sociais_Agendamentos 
                     set status='${status}'
                     where id=${id}`;
    await db.query(query);
  },
    
};
