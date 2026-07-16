const db = require('./MySQL.js');

// Converte 'DD/MM/YYYY' -> 'YYYY-MM-DD' (ou null). Aceita também 'YYYY-MM-DD'.
function _dataBRtoSQL(s) {
  if (!s) return null;
  const v = String(s).trim();
  if (v.includes('-')) return v;
  const p = v.split('/');
  if (p.length !== 3) return null;
  return `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
}

// Aceita "150.00" (decimal por ponto) e "1.500,00" (BR). Remove 'R$'.
function _parseValorFin(v) {
  let s = String(v || '0').replace('R$', '').trim();
  if (s.includes('.') && s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.'); // BR: ponto=milhar, vírgula=decimal
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// TODO: o restante deste arquivo (e dos outros DB_*.js) ainda concatena
// valores direto na query com escape manual de aspas — padrão vulnerável a
// SQL injection. Este backend Express é usado só em dev local, então o
// esforço de conversão geral não foi priorizado; o insert abaixo já usa
// placeholders (db.queryParam) e serve de modelo para migrar as demais.

module.exports = {
  insert: async function (id_condominio, financeiro, name) {
    let id_usuario = financeiro.id_usuario;
    if (!id_usuario && financeiro.nome && financeiro.nome.startsWith('Apto ')) {
      try {
        const regex = /Apto\s+([^\s]+)\s+Bloco\s+([^\s]+)/i;
        const match = financeiro.nome.match(regex);
        if (match) {
          const userRes = await db.queryParam(
            'select id_user from Moradores where id_condominio=? and apartamento=? and bloco=? limit 1',
            [id_condominio, match[1], match[2]],
          );
          if (userRes.results && userRes.results.length > 0) {
            id_usuario = userRes.results[0].id_user;
          }
        }
      } catch (err) {
        console.error('Error finding resident user:', err);
      }
    }

    const calculatedPago = financeiro.pago !== undefined && financeiro.pago !== null
      ? financeiro.pago
      : ((financeiro.categoria === 'Arrecadação' || (financeiro.nome && financeiro.nome.startsWith('Apto ')))
        ? 0
        : (financeiro.data == null || financeiro.data == "" ? 0 : 1));

    await db.queryParam(
      `insert into Financeiro (nome, tipo, valor, data, data_vencimento, categoria, conta, descricao, cliente, forma_pagamento, parcelas, nome_operador, id_condominio, photo, pago, url_boleto, status, id_usuario)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        financeiro.nome,
        financeiro.tipo,
        financeiro.valor,
        financeiro.data ?? null,
        financeiro.data_vencimento ?? null,
        financeiro.categoria,
        financeiro.conta ?? null,
        financeiro.descricao ?? null,
        financeiro.cliente ?? null,
        financeiro.forma_pagamento ?? null,
        financeiro.parcelas ?? null,
        name,
        id_condominio,
        financeiro.photo ?? null,
        calculatedPago,
        financeiro.url_boleto ?? null,
        financeiro.status != null ? financeiro.status : 0,
        id_usuario ?? null,
      ],
    );
  },

  getAll: async function (id_cond, mes, ano, getPendentes) {
    // Cobranças de taxa dos moradores (categoria 'Taxa Condominial') NÃO entram no
    // Financeiro do condomínio — vão para a aba Inadimplência. Mostra só receitas/
    // despesas do condomínio.
    const query = `select t1.id, t1.nome, t1.tipo, t1.valor, t1.categoria, t1.nome_operador, t1.pago, t1.status,
                      DATE_FORMAT(COALESCE(t1.data, t1.data_vencimento, t1.created_at), '%d') as dia,
                      DATE_FORMAT(COALESCE(t1.data, t1.data_vencimento, t1.created_at), '%m') as mes,
                      DATE_FORMAT(COALESCE(t1.data, t1.data_vencimento, t1.created_at), '%Y') as ano
                    from Financeiro as t1
                    where t1.id_condominio=${id_cond}
                      and (t1.categoria is null or t1.categoria <> 'Taxa Condominial')
                      and COALESCE(t1.data, t1.data_vencimento, t1.created_at) >= '${ano}-${mes}-01'
                      and COALESCE(t1.data, t1.data_vencimento, t1.created_at) < '${ano}-${mes}-01' + interval 1 month
                      ${getPendentes == false ? 'and t1.pago=1' : ''}
                    order by COALESCE(t1.data, t1.data_vencimento, t1.created_at) asc, t1.created_at desc`;
    const { results } = await db.query(query);
    return results;
  },

  getAllGrafico: async function (id_cond, mes, ano) {
    const query = `select t1.id, t1.nome, t1.tipo, t1.valor, t1.categoria, t1.pago,
                      DATE_FORMAT(COALESCE(t1.data, t1.data_vencimento, t1.created_at), '%d') as dia,
                      DATE_FORMAT(COALESCE(t1.data, t1.data_vencimento, t1.created_at), '%m') as mes,
                      DATE_FORMAT(COALESCE(t1.data, t1.data_vencimento, t1.created_at), '%Y') as ano
                    from Financeiro as t1
                    where t1.id_condominio=${id_cond}
                      and COALESCE(t1.data, t1.data_vencimento, t1.created_at) >= '${ano}-${mes}-01'
                      and COALESCE(t1.data, t1.data_vencimento, t1.created_at) < '${ano}-${mes}-01' + interval 1 month
                      and t1.pago = 1
                    order by t1.categoria asc`;
    const { results } = await db.query(query);
    return results;
  },

  getAllMoradores: async function (id_cond, mes, ano) {
    const query = `select a.id as apto_id, a.bloco, a.apto, 
                      f.valor, f.id as financeiro_id, DATE_FORMAT(f.data, '%d/%m/%Y') as data, DATE_FORMAT(f.data_vencimento, '%d/%m/%Y') as data_vencimento, f.conta, f.descricao, f.pago
                    from Apartamentos a
                    left join Financeiro f on (
                      f.nome like concat('Apto ', a.apto, ' Bloco ', a.bloco, ' - Ref. %')
                      and f.id_condominio=a.id_condominio
                      and (
                        (DATE_FORMAT(f.data_vencimento, '%m') = '${mes}' and DATE_FORMAT(f.data_vencimento, '%Y') = '${ano}')
                        or f.nome = concat('Apto ',a.apto,' Bloco ', a.bloco, ' - Ref. ', '${mes}', '/', '${ano}')
                        or f.nome = concat('Apto ',a.apto,' Bloco ', a.bloco, ' - Ref. ', '${mes}', '/', '${ano.slice(-2)}')
                        or f.nome = concat('Apto ',a.apto,' Bloco ', a.bloco, ' - Ref. ', '${parseInt(mes)}')
                      )
                    )
                      where a.id_condominio=${id_cond} 
                    group by a.bloco, a.apto 
                    order by a.bloco, a.apto asc`;
    const { results } = await db.query(query);
    return results;
  },

  getAllInadimplentes: async function (id_cond, meses) {
    if (!meses || meses.length === 0) return [];
    
    // Fetch all apartments
    const aptosQuery = `select id, bloco, apto from Apartamentos where id_condominio = ${id_cond} order by bloco, apto asc`;
    const { results: aptos } = await db.query(aptosQuery);

    // Fetch all paid faturas
    const faturasQuery = `select nome, data_vencimento from Financeiro where id_condominio = ${id_cond} and pago = 1`;
    const { results: faturasPagas } = await db.query(faturasQuery);

    const helper = {
      nomeFaturaDeApto(nome, apto, bloco) {
        if (!nome) return false;
        const cleanNome = nome.toUpperCase();
        const aptoRegex = new RegExp(`\\bAPTO\\s+${apto}\\b`, 'i');
        if (!aptoRegex.test(cleanNome)) return false;
        if (bloco) {
          const blocoRegex = new RegExp(`\\bBLOCO\\s+${bloco}\\b`, 'i');
          if (!blocoRegex.test(cleanNome)) return false;
        }
        return true;
      }
    };

    const blocosMap = {};

    for (const a of aptos) {
      const minhasPagas = faturasPagas.filter((f) =>
        helper.nomeFaturaDeApto(f.nome, a.apto, a.bloco)
      );

      let pagosCount = 0;
      for (const m of meses) {
        const anoCurto = m.ano.slice(-2);
        const match = minhasPagas.find((f) => {
          // 1. Try to match by date
          if (f.data_vencimento) {
            const fDate = new Date(f.data_vencimento);
            const fMes = String(fDate.getUTCMonth() + 1).padStart(2, '0');
            const fAno = String(fDate.getUTCFullYear());
            if (fMes === m.mes && fAno === m.ano) return true;
          }
          // 2. Try to match by name
          const refMatch = f.nome?.match(/Ref\.\s*(\d{1,2})(?:\/(\d{2,4}))?/i);
          if (refMatch) {
            const [, refMes, refAno] = refMatch;
            const refMesPad = refMes.padStart(2, '0');
            if (refMesPad === m.mes) {
              if (!refAno || refAno === m.ano || refAno === anoCurto) {
                return true;
              }
            }
          }
          return false;
        });
        if (match) {
          pagosCount++;
        }
      }

      const devendoCount = meses.length - pagosCount;
      const blocoKey = a.bloco || 'Sem Bloco';
      if (devendoCount > 0) {
        if (!blocosMap[blocoKey]) blocosMap[blocoKey] = [];
        blocosMap[blocoKey].push({
          bloco: blocoKey,
          apto: a.apto,
          qtd: devendoCount,
        });
      }
    }

    // Convert map to list
    const results = [];
    for (const b of Object.keys(blocosMap)) {
      for (const item of blocosMap[b]) {
        results.push(item);
      }
    }

    return results;
  },

  // Dashboard de Inadimplência (paridade com o NestJS): resumo + eventos do mês.
  getInadimplenciaDashboard: async function (id_cond, mes, ano) {
    const fmt = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const cobrancas = (await db.query(
      `select id, nome, valor, pago, status, data, data_vencimento, created_at, updated_at
         from Financeiro
        where id_condominio=${id_cond} and categoria='Taxa Condominial'
          and COALESCE(data, data_vencimento, created_at) >= '${ano}-${mes}-01'
          and COALESCE(data, data_vencimento, created_at) < '${ano}-${mes}-01' + interval 1 month
        order by updated_at desc`
    )).results;

    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    let totalArrecadado = 0, totalPendente = 0, qtdPagas = 0, qtdPendentes = 0;
    const aptosDevendo = new Set();
    const extrair = (nome) => {
      const m = /\bApto\s+(\S+)/i.exec(nome || '');
      const b = /\bBloco\s+(\S+)/i.exec(nome || '');
      return { apto: m ? m[1] : '', bloco: b ? b[1] : '' };
    };
    const eventos = [];
    const pagas = [], pendentes = [];
    const aptosMap = new Map();
    for (const c of cobrancas) {
      const v = Math.abs(Number(c.valor || 0));
      const { apto, bloco } = extrair(c.nome);
      const item = {
        id: c.id, nome: c.nome, apto, bloco, valor: v, valorString: fmt(v),
        data_vencimento: c.data_vencimento ? new Date(c.data_vencimento).toLocaleDateString('pt-BR') : '',
        pago: c.pago, status: c.status,
      };
      if (c.pago === 1) { totalArrecadado += v; qtdPagas++; pagas.push(item); }
      else {
        totalPendente += v; qtdPendentes++; pendentes.push(item);
        const key = `${bloco}-${apto || c.id}`;
        aptosDevendo.add(key);
        const ex = aptosMap.get(key) || { apto, bloco, qtd: 0, total: 0 };
        ex.qtd++; ex.total += v;
        aptosMap.set(key, ex);
      }
      const venc = c.data_vencimento ? new Date(c.data_vencimento) : null;
      if (venc) venc.setHours(0, 0, 0, 0);
      let tipo, data;
      if (c.pago === 1) { tipo = 'pagamento'; data = c.updated_at || c.data; }
      else if (venc && venc < hoje) { tipo = 'vencido'; data = venc; }
      else { tipo = 'gerada'; data = c.created_at; }
      const d = data ? new Date(data) : null;
      eventos.push({
        tipo, nome: c.nome, apto, bloco, valor: v, valorString: fmt(v),
        data: d ? d.toLocaleDateString('pt-BR') : '', dataOrd: d ? d.getTime() : 0,
      });
    }
    eventos.sort((a, b) => b.dataOrd - a.dataOrd);

    const totalAptos = (await db.query(
      `select count(*) c from Apartamentos where id_condominio=${id_cond}`
    )).results[0].c;
    const perc = totalAptos > 0 ? Math.round((aptosDevendo.size / totalAptos) * 1000) / 10 : 0;
    const aptosDevendoList = Array.from(aptosMap.values())
      .map((a) => ({ ...a, totalString: fmt(a.total) }))
      .sort((a, b) => b.total - a.total);

    return {
      resumo: {
        totalArrecadado: fmt(totalArrecadado),
        totalPendente: fmt(totalPendente),
        qtdPagas, qtdPendentes,
        qtdAptosDevendo: aptosDevendo.size,
        totalAptos, percInadimplencia: perc,
      },
      pagas, pendentes, aptosDevendo: aptosDevendoList,
      eventos: eventos.slice(0, 30),
    };
  },

  getInadimplenteDetail: async function (id_cond, meses, apto, bloco) {
    if (!meses || meses.length === 0) return [];
    const query = `select a.bloco, a.apto, f.nome, f.id, f.valor, f.pago, f.status,
                    DATE_FORMAT(f.data_vencimento, '%d/%m/%Y') as data_vencimento
                    from Apartamentos a
                    left join Financeiro f on (
                        f.nome like concat('Apto ', a.apto, ' Bloco ', a.bloco, ' - Ref. %')
                        and f.id_condominio=${id_cond}
                    )
                    where a.id_condominio=${id_cond} and a.apto='${apto}' and a.bloco='${bloco}'
                  `;
    const { results } = await db.query(query);
    var arr = [];
    meses.forEach(mes => {
      // Find a matched record that is PAID (pago = 1)
      var paidMatch = results.find(result => {
        if (!result.nome) return false;
        
        // 1. Try to match by date (DD/MM/YYYY)
        if (result.data_vencimento) {
          const parts = result.data_vencimento.split('/');
          if (parts.length === 3) {
            const rMes = parts[1];
            const rAno = parts[2];
            if (rMes === mes.mes && (rAno === mes.ano || rAno === mes.ano.slice(-2))) {
              return result.pago === 1;
            }
          }
        }
        
        // 2. Fallback to name pattern match
        const hasRefYear = result.nome.includes(mes.mes+'/'+mes.ano.slice(-2)) || result.nome.includes(mes.mes+'/'+mes.ano);
        const hasRefSingleMonth = result.nome.includes('Ref. ' + parseInt(mes.mes)) || result.nome.includes('Ref. ' + mes.mes);
        return (hasRefYear || hasRefSingleMonth) && result.pago === 1;
      });

      // If it's NOT paid, it is inadimplente
      if (!paidMatch) {
        // Find if there is a pending record (pago = 0 or null)
        var pendingMatch = results.find(result => {
          if (!result.nome) return false;
          
          // 1. Try to match by date (DD/MM/YYYY)
          if (result.data_vencimento) {
            const parts = result.data_vencimento.split('/');
            if (parts.length === 3) {
              const rMes = parts[1];
              const rAno = parts[2];
              if (rMes === mes.mes && (rAno === mes.ano || rAno === mes.ano.slice(-2))) {
                return true;
              }
            }
          }
          
          // 2. Fallback to name pattern match
          const hasRefYear = result.nome.includes(mes.mes+'/'+mes.ano.slice(-2)) || result.nome.includes(mes.mes+'/'+mes.ano);
          const hasRefSingleMonth = result.nome.includes('Ref. ' + parseInt(mes.mes)) || result.nome.includes('Ref. ' + mes.mes);
          return hasRefYear || hasRefSingleMonth;
        });

        arr.push({
          mes: mes.mes,
          ano: mes.ano,
          periodo: mes.periodo,
          id: pendingMatch ? pendingMatch.id : null,
          valor: pendingMatch ? pendingMatch.valor : null,
          status: pendingMatch ? pendingMatch.status : null,
          pago: pendingMatch ? pendingMatch.pago : null,
          data_vencimento: pendingMatch ? pendingMatch.data_vencimento : null
        });
      }
    });
    return arr;
  },

  getAllMeses: async function (id_cond) {
    const query = `select 
                      distinct DATE_FORMAT(COALESCE(t1.data, t1.data_vencimento, t1.created_at), '%m/%y') as periodo,
                      DATE_FORMAT(COALESCE(t1.data, t1.data_vencimento, t1.created_at), '%m') as mes,
                      DATE_FORMAT(COALESCE(t1.data, t1.data_vencimento, t1.created_at), '%Y') as ano
                    from Financeiro as t1
                    where t1.id_condominio=${id_cond}
                    order by ano asc, mes asc `;
    const { results } = await db.query(query);
    return results;
  },

  remove: async function (id) {
    const query = `delete from Financeiro where id=${id}`;
    await db.query(query);
  },

  update: async function (id_condominio, financeiro, name) {
    financeiro.nome = financeiro.nome.replaceAll("'","''");
    financeiro.descricao = financeiro.descricao.replaceAll("'","''");
    financeiro.tipo = financeiro.tipo.replaceAll("'","''");

    let id_usuario = financeiro.id_usuario;
    if (!id_usuario && financeiro.nome && financeiro.nome.startsWith('Apto ')) {
      try {
        const regex = /Apto\s+([^\s]+)\s+Bloco\s+([^\s]+)/i;
        const match = financeiro.nome.match(regex);
        if (match) {
          const apto = match[1];
          const bloco = match[2];
          const userRes = await db.query(`select id_user from Moradores where id_condominio=${id_condominio} and apartamento='${apto}' and bloco='${bloco}' limit 1`);
          if (userRes.results && userRes.results.length > 0) {
            id_usuario = userRes.results[0].id_user;
          }
        }
      } catch (err) {
        console.error('Error finding resident user:', err);
      }
    }
    
    const query = `update Financeiro 
                     set nome='${financeiro.nome}',
                      tipo='${financeiro.tipo}',
                      valor='${financeiro.valor}',
                      data=${financeiro.data != null ? `'${financeiro.data}'` : 'null'},
                      data_vencimento=${financeiro.data_vencimento != null ? `'${financeiro.data_vencimento}'` : 'null'},
                      categoria='${financeiro.categoria}',
                      conta=${financeiro.conta != null ? `'${financeiro.conta}'` : 'null'},
                      descricao=${financeiro.descricao != null ? `'${financeiro.descricao}'` : 'null'},
                      cliente=${financeiro.cliente != null ? `'${financeiro.cliente}'` : 'null'},
                      forma_pagamento=${financeiro.forma_pagamento != null ? `'${financeiro.forma_pagamento}'` : 'null'},
                      parcelas=${financeiro.parcelas != null ? `'${financeiro.parcelas}'` : 'null'},
                      nome_operador='${name}',
                      pago=${financeiro.pago !== undefined && financeiro.pago !== null ? financeiro.pago : (financeiro.data == null || financeiro.data == "" ? 0 : 1)},
                      url_boleto=${financeiro.url_boleto != null ? `'${financeiro.url_boleto}'` : 'url_boleto'},
                      url_comprovante=${financeiro.url_comprovante != null ? `'${financeiro.url_comprovante}'` : 'url_comprovante'},
                      status=${financeiro.status != null ? financeiro.status : 'status'},
                      id_usuario=${id_usuario != null ? id_usuario : 'id_usuario'}
                    where id=${financeiro.id} and id_condominio=${id_condominio}`;
    await db.query(query);
  },

  updatePhoto: async function (url, id){
    const query = `update Financeiro set photo='${url}' where id='${id}' `;
    await db.query(query);
  },

  /**
   * Conta pessoal do morador (tipo 'D', escopo por id_usuario). Paridade com o
   * NestJS de produção. Aceita o código escaneado (linha_digitavel/pix_copia_cola).
   */
  insertMoradorConta: async function (idUsuario, idCondominio, data) {
    const venc = _dataBRtoSQL(data.data_vencimento);
    const valor = _parseValorFin(data.valor);
    const nome = (data.nome || `${data.categoria || 'Conta'} Individual`);
    const pago = data.pago ? Number(data.pago) : 0;
    const query = `insert into Financeiro
        (nome, tipo, valor, data_vencimento, categoria, pago, status, id_condominio, id_usuario, linha_digitavel, pix_copia_cola)
      values (?, 'D', ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [
      nome, valor, venc, data.categoria || 'Outros', pago, pago === 1 ? '1' : '0',
      Number(idCondominio), Number(idUsuario), data.linha_digitavel || null, data.pix_copia_cola || null,
    ];
    const { results } = await db.queryParam(query, params);
    return results.insertId;
  },

  updateMoradorConta: async function (idUsuario, data) {
    const venc = _dataBRtoSQL(data.data_vencimento);
    const valor = _parseValorFin(data.valor);
    const pago = data.pago ? Number(data.pago) : 0;
    const sets = ['nome=?', 'valor=?', 'data_vencimento=?', 'categoria=?', 'pago=?', 'status=?'];
    const params = [data.nome, valor, venc, data.categoria, pago, pago === 1 ? '1' : '0'];
    if (data.linha_digitavel !== undefined) { sets.push('linha_digitavel=?'); params.push(data.linha_digitavel || null); }
    if (data.pix_copia_cola !== undefined) { sets.push('pix_copia_cola=?'); params.push(data.pix_copia_cola || null); }
    const query = `update Financeiro set ${sets.join(', ')} where id=? and id_usuario=?`;
    params.push(Number(data.id), Number(idUsuario));
    const { results } = await db.queryParam(query, params);
    return results.affectedRows;
  },

  /**
   * Anexa o código escaneado (linha digitável e/ou PIX copia-e-cola) a uma conta
   * do próprio morador (escopo por id_usuario). Só grava os campos enviados.
   */
  anexarCodigo: async function (id, idUsuario, { linha_digitavel, pix_copia_cola }) {
    const sets = [];
    const params = [];
    if (linha_digitavel !== undefined && linha_digitavel !== null && linha_digitavel !== '') {
      sets.push('linha_digitavel=?');
      params.push(linha_digitavel);
    }
    if (pix_copia_cola !== undefined && pix_copia_cola !== null && pix_copia_cola !== '') {
      sets.push('pix_copia_cola=?');
      params.push(pix_copia_cola);
    }
    if (sets.length === 0) return 0;
    const query = `update Financeiro set ${sets.join(', ')} where id=? and id_usuario=?`;
    params.push(id, idUsuario);
    const { results } = await db.queryParam(query, params);
    return results.affectedRows;
  },

  get: async function (id_cond, id) {
    const query = `select id, 
                        nome, 
                        tipo,
                        valor, 
                        DATE_FORMAT(data_vencimento, '%d/%m/%Y') as data_vencimento,
                        DATE_FORMAT(data, '%d/%m/%Y') as data,
                        categoria, 
                        conta,
                        descricao, 
                        cliente,
                        forma_pagamento,
                        parcelas,
                        photo,
                        pago,
                        id_usuario
                      from Financeiro
                      where id_condominio=${id_cond} and id=${id}`;
    const { results } = await db.query(query);
    return results[0];
  },

  getLastUpdate: async function (id_cond) {
    const query = `select DATE_FORMAT(created_at, '%d/%m/%Y') as data
                      from Financeiro
                    where id_condominio=${id_cond}
                    order by id desc limit 1`;
    const { results } = await db.query(query);
    if(results.length == 0){
      return "-";
    }
    return results[0].data;
  },

  updateBoleto: async function (url, id){
    const query = `update Financeiro set url_boleto='${url}' where id='${id}' `;
    await db.query(query);
  },

  updateComprovante: async function (url, id){
    const query = `update Financeiro set url_comprovante='${url}', status=2 where id='${id}' `;
    await db.query(query);
  },

  updateStatus: async function (status, id){
    const query = `update Financeiro set status=${status}, pago=${status == 1 ? 1 : 0} where id='${id}' `;
    await db.query(query);
  },

  getByUser: async function (id_user, id_cond) {
    // Apartamento (apto/bloco) do morador, para casar taxas antigas que ficaram
    // sem id_usuario preenchido mas cujo nome é "Apto X Bloco Y".
    const moradorRes = await db.query(
      `select apartamento, bloco from Moradores where id_user=${id_user} and id_condominio=${id_cond} limit 1`
    );
    const morador = moradorRes.results && moradorRes.results[0];

    // Casa o nome do lançamento ("Apto 101 Bloco A - ...") com o apto do morador.
    // Só vale quando há morador vinculado; senão, nunca casa (evita vazamento).
    const aptoMatch = morador
      ? `t1.nome like 'Apto ${String(morador.apartamento).replace(/'/g, "''")} Bloco ${String(morador.bloco).replace(/'/g, "''")} %'`
      : '0=1';

    // "Meu Financeiro" mostra apenas cobranças do próprio usuário:
    //  - lançamentos com id_usuario do usuário (inclui taxas de apto já vinculadas), ou
    //  - taxas de apto sem id_usuario cujo nome case com o apartamento do morador
    //    (cobre co-moradores e taxas antigas não vinculadas).
    // Despesas/receitas gerais do condomínio (id_usuario null, nome não-apto)
    // pertencem à aba "Condomínio" e NÃO devem aparecer aqui.
    const query = `select t1.id, t1.nome, t1.tipo, t1.valor, t1.categoria, t1.url_boleto, t1.url_comprovante, t1.status,
                    t1.pix_copia_cola, t1.linha_digitavel,
                    DATE_FORMAT(t1.data_vencimento, '%d/%m/%Y') as data_vencimento,
                    DATE_FORMAT(t1.data, '%d/%m/%Y') as data, t1.pago, c.chave_pix
                    from Financeiro as t1
                    left join Condominios as c on t1.id_condominio = c.id
                    where t1.id_condominio=${id_cond}
                      and (
                        t1.id_usuario=${id_user}
                        or (t1.id_usuario is null and t1.nome like 'Apto %' and ${aptoMatch})
                      )
                    order by t1.data_vencimento desc`;
    const { results } = await db.query(query);
    return results;
  },
    
};
