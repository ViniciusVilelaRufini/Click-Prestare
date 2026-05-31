const db = require('../database/DB_Condominio.js');
const saveToAWS = require('../utils/saveToAWS');
const doubleToReal = require('../utils/doubleToReal.js');

module.exports = {
  async register(req, res) {
    try {
      await db.registerAddress(req.body.address);
      const condId = await db.registerCondominio(req.body.condominio);
      if(req.body.condominio.photo){
        const urlPhotoProfile = await saveToAWS(req.body.condominio.photo, `condominios/${condId}`, 'profile');
        await db.updateCondominioPhoto(urlPhotoProfile.url, condId);
      }
      await db.vinculaCondominioSindico(req.session.user.id, condId);
      return res.json();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async update(req, res) {
    try {
      await db.updateCondominio(req.body.condominio);     
      if(req.body.condominio.photo){
        const urlPhotoProfile = await saveToAWS(req.body.condominio.photo, `condominios/${req.body.condominio.id}`, 'profile');
        await db.updateCondominioPhoto(urlPhotoProfile.url, req.body.condominio.id);
      }
      return res.json();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async updateMoeda(req, res) {
    try {
      await db.updateMoeda(req.body.condominio);      
      return res.json();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async updateAddress(req, res) {
    try {
      await db.updateAddress(req.body.address);     
      return res.json();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async updateAssinatura(req, res) {
    try {
      var vencimentoAtual = await db.getVencimento(req.body.assinatura.id_condominio);  
      var plano = await db.getPlano(req.body.assinatura.id_plano);        
      await db.updateVencimentoCondominio(req.body.assinatura.id_condominio, plano, vencimentoAtual.vencimento, vencimentoAtual.dias_restantes);
      await db.registerAssinatura(req.session.user.id, req.body.assinatura, plano, vencimentoAtual.vencimento, vencimentoAtual.dias_restantes);
      return res.json();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async getCondominio(req, res) {
    try {
      var cond = await db.getCondominio(req.query.id_condominio);
      cond.saldo = doubleToReal.convertDoubleToReal(cond.saldo ?? 0);
      cond.inadimplencia = doubleToReal.convertDoubleToReal(cond.inadimplencia ?? 0);
      return res.status(200).json( cond );
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async getList(req, res) {
    try {
      const list = await db.getList(req.session.user.id);
      return res.status(200).json({ list });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async getAllAptos(req, res) {
    try {
      const list = await db.getAllAptos(req.query.id_condominio);
      return res.status(200).json(list);
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async getInfos(req, res) {
    try {      
      var aux = await db.getInfos(req.query.id_condominio);  
      return res.json(aux);
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async getAddress(req, res) {
    try {      
      var aux = await db.getAddress(req.query.id_condominio);  
      return res.json(aux);
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

};