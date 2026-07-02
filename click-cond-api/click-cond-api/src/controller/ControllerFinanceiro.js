const { formatRelativeWithOptions } = require('date-fns/fp');
const db = require('../database/DB_Financeiro.js');
const doubleToReal = require('../utils/doubleToReal.js');
const stringExtension = require('../utils/stringExtension.js');
const saveToAWS = require('../utils/saveToAWS');

module.exports = {
  async insert(req, res) {
    try {
      // Mesma regra do backend NestJS de produção: lançamento com valor
      // zero/negativo é rejeitado (evita cobranças R$ 0,00 na inadimplência).
      const absValor = Math.abs(parseFloat(req.body.financeiro.valor) || 0);
      if (absValor <= 0 || absValor > 9999999) {
        return res.status(400).json({ message: 'O valor do lançamento deve ser maior que zero e menor que R$ 10.000.000,00.' });
      }

      if(req.body.financeiro.tipo == 'D'){
        req.body.financeiro.valor = req.body.financeiro.valor * -1;
      }
      
      if(req.body.financeiro.photo != null){
        const urlPhotoProfile = await saveToAWS(req.body.financeiro.photo, `condominios/${req.body.id_condominio}/financeiro`, 'lancamento');
        req.body.financeiro.photo = urlPhotoProfile.url;
      }

      await db.insert(req.body.id_condominio, req.body.financeiro, req.session.user.name);
      return res.json();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async getAll(req, res) {
    try {
      // CONSULTA MESES QUE TEM LANÇAMENTOS
      var meses = await db.getAllMeses(req.query.id_condominio);
      for (var i=0; i<meses.length; i++){
        const mes = meses[i];
        meses[i].periodo = stringExtension.convertMonthToReal(mes.mes, true)+'/'+mes.ano;
      }

      if(meses.length == 0){
        var today = new Date();
        var obj = {mes: today.getMonth()+1, ano: today.getFullYear(), periodo: ''};
        obj.periodo = stringExtension.convertMonthToReal(obj.mes, true)+'/'+obj.ano;
        meses.push(obj);
      }

      if(req.query.mes=='' || req.query.ano==''){
        req.query.mes = meses[meses.length-1].mes;
        req.query.ano = meses[meses.length-1].ano;
      }

      var getPendentes = req.session.user.typeAccess == "Sindico";

      const results = await db.getAll(req.query.id_condominio, req.query.mes, req.query.ano, getPendentes);

      // CONSULTA LANÇAMENTOS
      var arrayFinal = new Map();
      var saldo = 0;
      var totalReceita = 0;
      var totalDespesa = 0;
      var hasPaid = false;
      var dia = `${new Date().getDate()}/${req.query.mes}/${req.query.ano}`;
      for(var i=0; i<results.length; i++){       
        if(results[i].pago == 1){
          const valor = parseFloat(results[i].valor || 0);
          saldo += valor;
          if (valor > 0) totalReceita += valor;
          else totalDespesa += valor;
          hasPaid = true;
        }       
        if(results[i].ano < req.query.ano 
          || (results[i].ano == req.query.ano && results[i].mes < req.query.mes)          
          ){
            continue;
          }
        results[i].saldo=doubleToReal.convertDoubleToReal(saldo ?? 0);
        results[i].valorString=doubleToReal.convertDoubleToReal(results[i].valor ?? 0);
        if(arrayFinal[`${results[i].dia} de ${stringExtension.convertMonthToReal(results[i].mes, false)} de ${results[i].ano}`] == null){
          arrayFinal[`${results[i].dia} de ${stringExtension.convertMonthToReal(results[i].mes, false)} de ${results[i].ano}`] = [results[i]];
          dia = `${results[i].dia}/${req.query.mes}/${req.query.ano}`;
        }else{
          arrayFinal[`${results[i].dia} de ${stringExtension.convertMonthToReal(results[i].mes, false)} de ${results[i].ano}`].push(results[i]);
        }
      }
      return res.status(200).json({
        lancamentos: arrayFinal, 
        saldo: doubleToReal.convertDoubleToReal(saldo ?? 0), 
        totalReceita: doubleToReal.convertDoubleToReal(totalReceita),
        totalDespesa: doubleToReal.convertDoubleToReal(totalDespesa),
        dia: dia, 
        meses: meses
      });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async getAllMoradores(req, res) {
    try {
      var meses = await db.getAllMeses(req.query.id_condominio);
      for (var i=0; i<meses.length; i++){
        const mes = meses[i];
        meses[i].periodo = stringExtension.convertMonthToReal(mes.mes, true)+'/'+mes.ano;
      }
      const result = await db.getAllMoradores(req.query.id_condominio, req.query.mes, req.query.ano);
      var listBlocos = [];
      var ultimoApto = null;
      result.forEach(function(apto, i) {
        apto.mes = req.query.mes;
        apto.ano = req.query.ano;
        apto.valor = apto.valor ?? 0.0;
        apto.valorReal = doubleToReal.convertDoubleToReal(apto.valor ?? 0);
        if(ultimoApto == null || ultimoApto.bloco != apto.bloco){
          listBlocos.push({bloco: apto.bloco, total: "", aptos: [apto]})
          console.log(apto.bloco);
        }else{
          listBlocos[listBlocos.length-1].aptos.push(apto);
        }
        ultimoApto = apto;
      });
      listBlocos.forEach(function(bloco, i) {
        var total = 0.0;
        bloco.aptos.forEach(function(apto, i) {
          total += apto.valor ?? 0.0;
        });
        listBlocos[i].total = doubleToReal.convertDoubleToReal(total);
      });
      return res.status(200).json({meses: meses, blocos: listBlocos});
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async getAllInadimplentes(req, res) {
    try {
      var meses = await db.getAllMeses(req.query.id_condominio);
      const result = await db.getAllInadimplentes(req.query.id_condominio, meses);   

      var listBlocos = [];
      var ultimoApto = null;
      result.forEach(function(apto, i) {               
        if(ultimoApto == null || ultimoApto.bloco != apto.bloco){
          listBlocos.push({bloco: apto.bloco, aptos: [apto]})
        }else{
          listBlocos[listBlocos.length-1].aptos.push(apto);
        }
        ultimoApto = apto;
      });

      return res.status(200).json({blocos: listBlocos});
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async getInadimplenciaDashboard(req, res) {
    try {
      const id_cond = req.query.id_condominio;
      const meses = await db.getAllMeses(id_cond);
      let mes = req.query.mes, ano = req.query.ano;
      if ((!mes || !ano) && meses.length > 0) {
        const ult = meses[meses.length - 1];
        mes = ult.mes; ano = ult.ano;
      }
      const dash = await db.getInadimplenciaDashboard(id_cond, mes, ano);

      // Blocos (reusa a agregação de inadimplentes)
      const inad = await db.getAllInadimplentes(id_cond, meses);
      const listBlocos = [];
      let ultimoApto = null;
      inad.forEach(function (apto) {
        if (ultimoApto == null || ultimoApto.bloco != apto.bloco) {
          listBlocos.push({ bloco: apto.bloco, aptos: [apto] });
        } else {
          listBlocos[listBlocos.length - 1].aptos.push(apto);
        }
        ultimoApto = apto;
      });

      return res.status(200).json({ ...dash, blocos: listBlocos, meses });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  // Dev: o Express não tem o serviço de push/email (isso roda no NestJS de produção).
  // Stub para o app não quebrar ao notificar em ambiente de desenvolvimento.
  async notifyInadimplente(req, res) {
    return res.status(200).json({ success: true, message: '(dev) notificação simulada' });
  },

  async getInadimplenteDetail(req, res) {
    try {
      var meses = await db.getAllMeses(req.query.id_condominio);
      const result = await db.getInadimplenteDetail(req.query.id_condominio, meses, req.query.apto, req.query.bloco);
      return res.status(200).json(result);
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async remove(req, res) {
    try {
      await db.remove(req.body.id);
      return res.json();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async update(req, res) {
    try {
      if(req.body.financeiro.tipo == 'D'){
        req.body.financeiro.valor = req.body.financeiro.valor * -1;
      }
      if(req.body.financeiro.photo != null){
        const urlPhotoProfile = await saveToAWS(req.body.financeiro.photo, `condominios/${req.body.id_condominio}/financeiro`, 'lancamento');
        await db.updatePhoto(urlPhotoProfile.url, req.body.financeiro.id);
      }
      await db.update(req.body.id_condominio, req.body.financeiro, req.session.user.name);
      return res.json();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async get(req, res) {
    try {
      const user = req.session.user;
      const result = await db.get(req.query.id_condominio, req.query.id);

      if (!result) return res.status(404).json({ message: "Lançamento não encontrado." });

      // Enforce isolation for residents
      if (user.typeAccess === 'Morador') {
        // A resident can only see their own entries OR public condo entries (id_usuario is null)
        // Note: we need to check id_usuario. Let's make sure db.get returns it.
        if (result.id_usuario && result.id_usuario !== user.id) {
          return res.status(403).json({ message: "Acesso negado: Este lançamento financeiro não pertence a você." });
        }
      }

      return res.status(200).json(result);
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async getGrafico(req, res) {
    try {
      var meses = await db.getAllMeses(req.query.id_condominio);
      for (var i=0; i<meses.length; i++){
        const mes = meses[i];
        meses[i].periodo = stringExtension.convertMonthToReal(mes.mes, true)+'/'+mes.ano;
      }

      const results = await db.getAllGrafico(req.query.id_condominio, req.query.mes, req.query.ano);

      var listCategs = [];
      var ultimoLancamento = null;
      var totalReceita = 0.0;
      var totalDespesa = 0.0;
      var saldo = 0.0;
      results.forEach(function(lancamento, i) {               
        if(ultimoLancamento == null || ultimoLancamento.categoria != lancamento.categoria){
          listCategs.push({categoria: lancamento.categoria, saldo: lancamento.valor, tipo: lancamento.tipo, percentual:0.0})
        }else{
          listCategs[listCategs.length-1].saldo += lancamento.valor;
        }
        if(lancamento.tipo == "C"){totalReceita += lancamento.valor;}
        if(lancamento.tipo == "D"){totalDespesa += lancamento.valor;}
        saldo += lancamento.valor;
        ultimoLancamento = lancamento;
      });

      listCategs.forEach(function(categ, i) {       
        var percentual = (categ.saldo * 100)/(totalReceita+(-1*totalDespesa));
        if(percentual < 0){percentual = percentual*-1;}
        listCategs[i].percentual = parseFloat(percentual.toFixed(2));
        listCategs[i].percentualString = percentual.toFixed(2)+"%";
        listCategs[i].saldoReal = doubleToReal.convertDoubleToReal(listCategs[i].saldo);
      });
      totalReceitaReal = doubleToReal.convertDoubleToReal(totalReceita);
      totalDespesaReal = doubleToReal.convertDoubleToReal(totalDespesa);
      percentualReceita = (totalReceita * 100)/(totalReceita+(-1*totalDespesa));
      percentualReceita = percentualReceita.toFixed(2)+"%";
      percentualDespesa = (totalDespesa * -1 * 100)/(totalReceita+(-1*totalDespesa));
      percentualDespesa = percentualDespesa.toFixed(2)+"%";
      saldoReal = doubleToReal.convertDoubleToReal(saldo);

      return res.status(200).json({meses:meses, categorias: listCategs, totalReceita, totalDespesa, saldo, saldoReal, totalReceitaReal, totalDespesaReal, percentualReceita, percentualDespesa});
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async uploadSharedFile(req, res) {
    try {
      const { id, file, type } = req.body;
      const folder = type === 'boleto' ? 'boletos' : 'comprovantes';
      const urlFile = await saveToAWS(file, `condominios/${req.session.user.id_condominio}/financeiro/${folder}`, type);
      
      if (type === 'boleto') {
        await db.updateBoleto(urlFile.url, id);
      } else {
        await db.updateComprovante(urlFile.url, id);
      }
      
      return res.json({ url: urlFile.url });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async updateStatus(req, res) {
    try {
      await db.updateStatus(req.body.status, req.body.id);
      return res.json();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async getByUser(req, res) {
    try {
      let id_user = req.query.id_user;
      const user = req.session.user;

      // Enforce data isolation for residents
      if (user.typeAccess === 'Morador') {
        if (id_user && parseInt(id_user) !== user.id) {
          console.warn(`[SECURITY] Resident ${user.id} attempted to access financial data of user ${id_user}.`);
          return res.status(403).json({ message: "Acesso negado: Você só pode ver os seus próprios dados financeiros." });
        }
        id_user = user.id; // Force their own ID
      }

      const results = await db.getByUser(id_user, req.query.id_condominio);
      results.forEach(item => {
        item.valorReal = doubleToReal.convertDoubleToReal(item.valor ?? 0);
      });
      return res.status(200).json(results);
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

};