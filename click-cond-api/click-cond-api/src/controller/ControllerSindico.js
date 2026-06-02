const db = require('../database/DB_Sindico');
const dbUsers = require('../database/DB_Users');
const dbMoradores = require('../database/DB_Moradores');
const dbFinanceiro = require('../database/DB_Financeiro');
const jwt = require('jsonwebtoken');
const config = require('../configs/config');
const request = require('request');
const cryptoRandomString = require('crypto-random-string');
const mail = require('../services/Mails.js');
const NodeCache = require('node-cache');
const myCache = new NodeCache();
const saveToAWS = require('../utils/saveToAWS');
const doubleToReal = require('../utils/doubleToReal.js');

module.exports = {
  async login(req, res) {
    login(req, res, 'E-mail', false);
  },

  async signup(req, res) {
    try {
      const { nome, email, password, date_birth, phone, doc_identification, photo } = req.body;
      const userId = await db.insertUser(email, password, photo);
      await db.insertSindico(nome, email, date_birth, phone, doc_identification, userId);
      if(photo != null){
        const urlPhotoProfile = await saveToAWS(photo, `sindicos/${userId}`, 'profile');
        await dbUsers.updateProfilePhoto(urlPhotoProfile.url, userId);
      }
      req.body.login=email;
      login(req, res, false);
    } catch (err) {
      return res.status(400).json({ message: err.message });
    }
  },

  async update(req, res) {
    try {      
      const { nome, doc_identification, date_birth, email, phone, photo } = req.body;
      const userId = req.session.user.id;      

      await dbUsers.updateEmail(userId, email);

      await db.updateSindico(nome, email, date_birth, phone, doc_identification, userId);
      if(photo != null && !photo.includes("https://")){
        const urlPhotoProfile = await saveToAWS(photo, `sindicos/${userId}`, 'profile');
        await dbUsers.updateProfilePhoto(urlPhotoProfile.url, userId);
      }
      req.body.login=email;
      login(req, res, true);
    } catch (err) {
      return res.status(400).json({ message: err.message });
    }
  },

  async recoveryPassword(req, res) {
    const { email } = req.body;
    try {
      var login_type = await dbUsers.recoveryPassword(email, true, false, false);
      const newPassword = cryptoRandomString({ length: 6 });
      await dbUsers.setNewPassword(email, newPassword);
      await mail.mailForgotPassword(email, newPassword, login_type);
      return res.json({ message: 'Um e-mail foi enviado à você!' });
    } catch (err) {
      return res.status(400).json({ message: err.message });
    }
  },

  async newPassword(req, res) {
    try {
      const { newPassword, token } = req.body;
      const email = myCache.get(token);
      if (email == undefined) {
        return res.status(422).json({ message: 'O tempo expirou! Por favor, peça um novo link para a recuperação de sua senha.' });
      }
      await dbUsers.setNewPassword(email, newPassword);
      myCache.del(token);

      return res.json({ message: 'Senha alterada com sucesso' });
    } catch (err) {
      return res.status(400).json({ message: err.message });
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

  async getData(req, res) {
    try {
      var user = await db.getData(req.session.user.id);
      return res.json(user);
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  // Auto-vínculo: o próprio síndico logado se cadastra como morador de um apto.
  async linkMorador(req, res) {
    try {
      const idUser = req.session.user.id;
      const { id_apartamento, tipo } = req.body;
      if (!id_apartamento) return res.status(400).json({ message: 'Apartamento não informado.' });
      const r = await dbMoradores.linkExistingUserAsMorador(idUser, id_apartamento, tipo || 'proprietario');
      return res.status(200).json(r);
    } catch (err) {
      return res.status(400).json({ message: err.message });
    }
  },

  async listSindicos(req, res) {
    try {
      const list = await db.listSindicosCondominio(req.query.id_condominio);
      return res.status(200).json(list);
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
};

async function login(req, res, internalLogin) {
  try {
    const { login, password } = req.body;
    const result = internalLogin == true ? await db.internalLogin(login) : await db.login(login, password);
    result.typeAccess = 'Sindico';

    const token = jwt.sign({ user: { ...result } }, config.jwt.secretKey, {});
    delete result.typeAccess;
    return res.json({ token: token, user: result });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
}
