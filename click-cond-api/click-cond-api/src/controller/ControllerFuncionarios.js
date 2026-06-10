const db = require('../database/DB_Funcionarios.js');
const dbUsers = require('../database/DB_Users');
const saveToAWS = require('../utils/saveToAWS');
const jwt = require('jsonwebtoken');
const config = require('../configs/config');
const cryptoRandomString = require('crypto-random-string');
const mail = require('../services/Mails.js');

module.exports = {
  async login(req, res) {
    login(req, res, false);
  },

  async insert(req, res) {
    try {
      const { nome, email, telefone, documento, funcao, ch, senha, photo, permissoes, extra1, extra2, hasPortariaAccess } = req.body.funcionario;
      const userId = await db.insertUser(email, senha, photo);
      await db.insertFuncionario(nome, documento, email, telefone, funcao, ch, extra1, extra2, userId, req.body.id_condominio);
      await dbUsers.syncUserProfile(userId, { name: nome, email, phone: telefone, doc_identification: documento });
      if(photo != null){
        const urlPhotoProfile = await saveToAWS(photo, `condominios/${req.body.id_condominio}/funcionarios`, 'profile');
        await db.updateProfilePhoto(urlPhotoProfile.url, userId);
      }
      await db.updatePermissoes(permissoes, userId);

      if (hasPortariaAccess) {
        await db.insertPortariaAccess(nome, email, senha, email, telefone, req.body.id_condominio);
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
      // Fetch user to get email for Portaria removal before deleting user
      const user = await db.get(req.body.id);
      if (user && user.email) {
        await db.removePortariaAccess(user.email, user.id_condominio);
      }
      await db.remove(req.body.id);
      return res.json();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async update(req, res) {
    try {
      const { id, nome, email, telefone, documento, funcao, ch, permissoes, extra1, extra2, senha, photo, hasPortariaAccess } = req.body.funcionario;
      if(photo != null){
        const urlPhotoProfile = await saveToAWS(photo, `condominios/${req.body.id_condominio}/funcionarios`, 'profile');
        await db.updateProfilePhoto(urlPhotoProfile.url, id);
      }
      await db.updateUserLogin(email, id);
      await db.updateFuncionario(nome, documento, email, telefone, funcao, ch, extra1, extra2, id);
      await dbUsers.syncUserProfile(id, { name: nome, email, phone: telefone, doc_identification: documento });
      await db.updatePermissoes(permissoes, id);

      // If hasPortariaAccess is toggled, insert/update or remove
      if (hasPortariaAccess) {
        // If password is blank on update, we shouldn't overwrite portaria password with empty. 
        // We might need to handle password update carefully, but for now we'll pass whatever we have.
        // If senha is empty, we don't update password in Portaria, but insertPortariaAccess requires a password.
        // Actually, if updating, we might just re-insert. But MD5('') would break login.
        // Let's assume if hasPortariaAccess is true, we at least ensure it exists.
        // Since we don't know the old password, we only update password if provided.
        if (senha && senha.trim().length > 0) {
            await db.insertPortariaAccess(nome, email, senha, email, telefone, req.body.id_condominio);
        } else {
            // To ensure it exists without changing password, we can run a simple update or ignore if exists
            // A quick fix is to execute a safe update or leave it be if they didn't type a password
            const querySafe = `INSERT IGNORE INTO Funcionarios_Portaria (nome, login, password, email, telefone, id_condominio, ativo) 
                               VALUES ('${nome}', '${email}', '', '${email}', '${telefone}', ${req.body.id_condominio}, 1)
                               ON DUPLICATE KEY UPDATE nome='${nome}', email='${email}', telefone='${telefone}', ativo=1`;
            await require('../database/MySQL.js').query(querySafe);
        }
      } else {
        await db.removePortariaAccess(email, req.body.id_condominio);
      }

      return res.json();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async updateInfos(req, res) {
    try {
      const { id, nome, email, telefone, documento, photo } = req.body.funcionario;
      if(photo != null){
        const urlPhotoProfile = await saveToAWS(photo, `condominios/${req.body.id_condominio}/funcionarios`, 'profile');
        await db.updateProfilePhoto(urlPhotoProfile.url, id);
      }
      await db.updateUserLogin(email, id);
      await db.updateFuncionarioInfos(nome, documento, email, telefone, id);
      await dbUsers.syncUserProfile(id, { name: nome, email, phone: telefone, doc_identification: documento });
      req.body.login = email;
      login(req, res, true);

    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async get(req, res) {
    try {
      var userId = req.query.id;
      if(req.session.user.typeAccess == "Funcionario"){
        userId = req.session.user.id;
      }
      const result = await db.get(userId);
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
      return res.status(200).json( list );
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async recoveryPassword(req, res) {
    const { email } = req.body;
    try {
      var login_type = await dbUsers.recoveryPassword(email, false, false, true);
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
    result.typeAccess = 'Funcionario';

    const token = jwt.sign({ user: { ...result } }, config.jwt.secretKey, {});
    delete result.typeAccess;
    return res.json({ token: token, user: result });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
}