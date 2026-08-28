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

  // "Meus eventos" da home: acessos (entrada/saída) do próprio usuário como morador
  // + acessos dos visitantes/prestadores que ele cadastrou ou do seu apartamento.
  // Últimos 30 dias, ordenados do mais recente para o mais antigo.
  getMeusEventos: async function (idUser, limit) {
    const lim = Math.min(Math.max(parseInt(limit, 10) || 15, 1), 50);
    const uid = parseInt(idUser, 10);
    if (!uid) return [];

    const { results: moras } = await db.queryParam(
      'select id from Moradores where id_user = ?', [uid]);
    const moradorIds = moras.map((m) => m.id);

    const { results: aptosU } = await db.queryParam(
      'select id_apto from Apartamentos_Users where id_user = ?', [uid]);
    const aptoIds = aptosU.map((a) => a.id_apto);

    // Visitantes cadastrados pelo usuário OU vinculados ao(s) apartamento(s) dele.
    let visitorIds = [];
    {
      const conds = ['user = ?'];
      const params = [uid];
      if (aptoIds.length > 0) {
        conds.push(`id_apartamento in (${aptoIds.map(() => '?').join(',')})`);
        params.push(...aptoIds);
      }
      const { results: vis } = await db.queryParam(
        `select id from Visitantes where ${conds.join(' or ')}`, params);
      visitorIds = vis.map((v) => v.id);
    }

    const eventos = [];
    const selectBase = `select af.id, af.id_pessoa, af.nome_pessoa, af.evento, af.timestamp, af.tipo_pessoa,
                               af.tipo_dispositivo, af.confianca, c.nome as condominio
                          from Acessos_Facial af
                          left join Condominios c on c.id = af.id_condominio`;

    if (moradorIds.length > 0) {
      const ph = moradorIds.map(() => '?').join(',');
      const { results } = await db.queryParam(
        `${selectBase}
          where af.tipo_pessoa = 'morador' and af.id_pessoa in (${ph})
            and af.evento in ('entrada','saida')
            and af.timestamp >= date_sub(now(), interval 30 day)
          order by af.timestamp desc limit 40`, moradorIds);
      for (const r of results) eventos.push({ ...r, categoria: 'voce' });
    }

    if (visitorIds.length > 0) {
      const ph = visitorIds.map(() => '?').join(',');
      const { results } = await db.queryParam(
        `${selectBase}
          where af.tipo_pessoa in ('visitante','prestador') and af.id_pessoa in (${ph})
            and af.evento in ('entrada','saida')
            and af.timestamp >= date_sub(now(), interval 30 day)
          order by af.timestamp desc limit 40`, visitorIds);
      for (const r of results) eventos.push({ ...r, categoria: 'visitante' });
    }

    eventos.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return eventos.slice(0, lim).map((e) => ({
      id: e.id,
      id_pessoa: e.id_pessoa,
      nome: (e.nome_pessoa || '').replace(/\s*\([^)]*\)\s*$/, '').trim(),
      evento: e.evento,
      tipo_pessoa: e.tipo_pessoa,
      tipo_dispositivo: e.tipo_dispositivo,
      confianca: e.confianca,
      categoria: e.categoria,
      condominio: e.condominio || '',
      timestamp: e.timestamp,
    }));
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
