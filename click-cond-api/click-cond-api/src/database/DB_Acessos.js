const db = require('./MySQL.js');

module.exports = {
  // Últimos acessos de um visitante na tabela Acessos_Facial.
  // Paridade com o NestJS (facial.service.ts listAcessosPessoa): devolve as mesmas
  // chaves que o app lê e extrai `observacao` do nome_pessoa (motivo de bloqueio
  // entre parênteses, ex.: "Fulano (anti-passback)").
  getByVisitante: async function (idVisitante, limit) {
    // LIMIT não aceita placeholder (?) em prepared statement do mysql2 — por isso
    // o valor vai inline, já sanitizado para inteiro no intervalo [1,100].
    const lim = Math.min(Math.max(parseInt(limit, 10) || 5, 1), 100);
    const query = `
      select id, id_condominio, id_device, tipo_dispositivo, face_id, tipo_pessoa,
             id_pessoa, nome_pessoa, evento, confianca, timestamp
        from Acessos_Facial
       where tipo_pessoa = 'visitante' and id_pessoa = ?
       order by timestamp desc
       limit ${lim}`;
    const { results } = await db.queryParam(query, [parseInt(idVisitante, 10)]);
    return (results || []).map((a) => {
      let observacao = null;
      const match = (a.nome_pessoa || '').match(/\(([^)]+)\)/);
      if (match) observacao = match[1];
      return { ...a, observacao };
    });
  },

  // Condomínio de um visitante — usado para validar tenant antes de devolver acessos.
  getCondominioByVisitante: async function (idVisitante) {
    const { results } = await db.queryParam(
      'select id_condominio, id_apartamento from Visitantes where id = ? limit 1',
      [parseInt(idVisitante, 10)],
    );
    return results && results[0] ? results[0] : null;
  },
};
