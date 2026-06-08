const db = require('./MySQL.js');

module.exports = {
  // Últimos acessos de um visitante na tabela Acessos_Facial.
  // Paridade com o NestJS (facial.service.ts listAcessosPessoa): devolve as mesmas
  // chaves que o app lê e extrai `observacao` do nome_pessoa (motivo de bloqueio
  // entre parênteses, ex.: "Fulano (anti-passback)").
  getByVisitante: async function (idVisitante, limit) {
    const lim = Math.min(Math.max(parseInt(limit, 10) || 5, 1), 100);
    
    const { results: visRes } = await db.queryParam(
      'select * from Visitantes where id = ? limit 1',
      [parseInt(idVisitante, 10)]
    );
    if (!visRes || visRes.length === 0) return [];
    const v = visRes[0];

    let todasVisitas;
    if (v.doc_identificacao) {
      const q = 'select * from Visitantes where id_condominio = ? and nome = ? and doc_identificacao = ? order by created_at desc';
      const { results } = await db.queryParam(q, [v.id_condominio, v.nome, v.doc_identificacao]);
      todasVisitas = results || [];
    } else {
      const q = 'select * from Visitantes where id_condominio = ? and nome = ? and (doc_identificacao is null or doc_identificacao = "") order by created_at desc';
      const { results } = await db.queryParam(q, [v.id_condominio, v.nome]);
      todasVisitas = results || [];
    }

    const todosVisIds = todasVisitas.map(x => x.id);

    let acessosFacial = [];
    if (todosVisIds.length > 0) {
      const placeholders = todosVisIds.map(() => '?').join(',');
      const facialQuery = `
        select id, id_condominio, id_device, tipo_dispositivo, face_id, tipo_pessoa,
               id_pessoa, nome_pessoa, evento, confianca, timestamp
          from Acessos_Facial
         where tipo_pessoa = 'visitante' and id_pessoa in (${placeholders})
         order by timestamp desc
         limit 100`;
      const { results } = await db.queryParam(facialQuery, todosVisIds);
      acessosFacial = results || [];
    }

    const DEDUP_MS = 15000;
    const facialBuckets = new Set();
    for (const a of acessosFacial) {
      const ts = new Date(a.timestamp);
      const b = Math.floor(ts.getTime() / DEDUP_MS);
      facialBuckets.add(`${a.id_pessoa}:${a.evento}:${b}`);
      facialBuckets.add(`${a.id_pessoa}:${a.evento}:${b - 1}`);
      facialBuckets.add(`${a.id_pessoa}:${a.evento}:${b + 1}`);
    }

    const isDup = (idVis, evento, tsDate) => {
      if (!tsDate) return false;
      const ts = new Date(tsDate);
      const b = Math.floor(ts.getTime() / DEDUP_MS);
      return facialBuckets.has(`${idVis}:${evento}:${b}`);
    };

    const mergedList = [];

    // Adiciona acessos faciais
    for (const a of acessosFacial) {
      let observacao = null;
      const match = (a.nome_pessoa || '').match(/\(([^)]+)\)/);
      if (match) observacao = match[1];
      mergedList.push({
        id: a.id,
        id_condominio: a.id_condominio,
        id_device: a.id_device,
        tipo_dispositivo: a.tipo_dispositivo,
        face_id: a.face_id,
        tipo_pessoa: 'visitante',
        id_pessoa: a.id_pessoa,
        nome_pessoa: a.nome_pessoa,
        evento: a.evento === 'saida' ? 'saida' : a.evento === 'negado' ? 'negado' : 'entrada',
        confianca: a.confianca,
        timestamp: new Date(a.timestamp),
        observacao
      });
    }

    // Adiciona entradas/saídas por PIN/manual
    for (const reg of todasVisitas) {
      if (reg.data_entrada && !isDup(reg.id, 'entrada', reg.data_entrada)) {
        mergedList.push({
          id: reg.id * 1000 + 1,
          id_condominio: reg.id_condominio,
          tipo_dispositivo: 'pin',
          tipo_pessoa: 'visitante',
          id_pessoa: reg.id,
          nome_pessoa: reg.nome,
          evento: 'entrada',
          timestamp: new Date(reg.data_entrada)
        });
      }
      if (reg.data_saida && !isDup(reg.id, 'saida', reg.data_saida)) {
        mergedList.push({
          id: reg.id * 1000 + 2,
          id_condominio: reg.id_condominio,
          tipo_dispositivo: 'pin',
          tipo_pessoa: 'visitante',
          id_pessoa: reg.id,
          nome_pessoa: reg.nome,
          evento: 'saida',
          timestamp: new Date(reg.data_saida)
        });
      }
    }

    mergedList.sort((x, y) => y.timestamp.getTime() - x.timestamp.getTime());
    return mergedList.slice(0, lim);
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
