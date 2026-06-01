const db = require('../database/DB_Moradores.js');
const dbUsers = require('../database/DB_Users');
const dbFinanceiro = require('../database/DB_Financeiro');
const saveToAWS = require('../utils/saveToAWS');
const jwt = require('jsonwebtoken');
const config = require('../configs/config');
const cryptoRandomString = require('crypto-random-string');
const mail = require('../services/Mails.js');
const doubleToReal = require('../utils/doubleToReal.js');

module.exports = {
  async login(req, res) {
    login(req, res, false);
  },

  async insert(req, res) {
    try {
      const { nome, email, telefone, documento, tipo, id_apto, photo, data_nascimento, extra1, extra2, extra3, extra4 } = req.body.morador;
      const senha = documento;
      const userId = await db.insertUser(email, senha);
      await db.insertMorador(nome, email, telefone, data_nascimento, documento, tipo, id_apto, userId, extra1, extra2, extra3, extra4, req.body.id_condominio);      
      if(photo != null){
        const urlPhotoProfile = await saveToAWS(photo, `condominios/${req.body.id_condominio}/moradores`, 'profile');
        await db.updateProfilePhoto(urlPhotoProfile.url, userId);
      }
      if (req.body.sendCredentials && email) {
        mail.mailWelcomeMorador(email, nome, documento).catch(e => console.log('Erro ao enviar email de welcome:', e));
      }
      return res.json();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async getAll(req, res) {
    try {
      const result = await db.getAll(req.query.id_condominio, req.query.offset);
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
      const { id, nome, email, telefone, data_nascimento, documento, photo, extra1, extra2, extra3, extra4 } = req.body.morador;
      if(photo != null){
        const urlPhotoProfile = await saveToAWS(photo, `condominios/${req.body.id_condominio}/moradores`, 'profile');
        await db.updateProfilePhoto(urlPhotoProfile.url, id);
      }
      await db.updateUserLogin(email, id, true);
      await db.updateMorador(nome, documento, email, telefone, data_nascimento, extra1, extra2, extra3, extra4, id);

      if(req.session.user.typeAccess == "Morador"){
        req.body.login = email;
        login(req, res, true)
      } else {
        return res.json();
      }      
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async get(req, res) {
    try {
      var userId = req.query.id;
      if(req.session.user.typeAccess == "Morador"){
        userId = req.session.user.id;
      }
      const idCondominio = req.query.id_condominio || (req.session.user ? req.session.user.id_condominio : undefined);
      const result = await db.get(userId, idCondominio);
      return res.status(200).json(result);
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async updateStatus(req, res) {
    try {
      await db.updateStatus(req.body.id_condominio, req.body.id, req.body.status);
      return res.json();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async listCondominios(req, res) {
    try {
      var list = await db.listCondominios(req.session.user.id);
      for(var i=0; i<list.length; i++){
        list[i].saldo = doubleToReal.convertDoubleToReal(list[i].saldo ?? 0);
        if(!list[i].data_financeiro) list[i].data_financeiro = "-";
      }
      return res.status(200).json( list );
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async recoveryPassword(req, res) {
    const { email } = req.body;
    try {
      var login_type = await dbUsers.recoveryPassword(email, false, true, false);
      const newPassword = cryptoRandomString({ length: 6 });
      await dbUsers.setNewPassword(email, newPassword);
      await mail.mailForgotPassword(email, newPassword, login_type);
      return res.json({ message: 'Um e-mail foi enviado à você!' });
    } catch (err) {
      return res.status(400).json({ message: err.message });
    }
  },

  async updateAssinatura(req, res) {
    try {
      var vencimentoAtual = await db.getVencimento(req.session.user.id);  
      var plano = await db.getPlano(req.body.assinatura.id_plano);    
      await db.updateVencimentoMorador(req.session.user.id, plano, vencimentoAtual.vencimento, vencimentoAtual.dias_restantes);
      await db.registerAssinatura(req.session.user.id, req.body.assinatura, plano, vencimentoAtual.vencimento, vencimentoAtual.dias_restantes);
      vencimentoAtual = await db.getVencimento(req.session.user.id);  
      return res.json(vencimentoAtual);
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async newPassword(req, res) {    
    try {
      const { senha } = req.body;
      await dbUsers.setNewPasswordById(req.session.user.id, senha);
      return res.json();
    } catch (err) {
      return res.status(400).json({ message: err.message });
    }
  },

  async sendCredentials(req, res) {
    try {
      const { email, nome, documento } = req.body;
      if (!email) {
        return res.status(400).json({ message: 'E-mail do morador não fornecido.' });
      }
      await mail.mailWelcomeMorador(email, nome || 'Morador', documento || '123456');
      return res.json({ message: 'Credenciais enviadas com sucesso!' });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

};

async function login(req, res, internalLogin) {
  try {
    const { login, password } = req.body;
    const result = internalLogin == true ? await db.internalLogin(login) : await db.login(login, password);
    result.typeAccess = 'Morador';

    const token = jwt.sign({ user: { ...result } }, config.jwt.secretKey, {});
    delete result.typeAccess;
    return res.json({ token: token, user: result });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
}