const db = require('../database/DB_Dashboard.js');
const dbAcessos = require('../database/DB_Acessos.js');
const jwt = require('jsonwebtoken');
const config = require('../configs/config');

module.exports = {
  async login(req, res) {
    try {
      const { login, password } = req.body;
      if(login != "admin@click.com" && password != "click@2023"){
        throw new Error('Login ou Senha incorretos');
      }

      var user = {nome: "Admin", typeAccess:"Admin"};

      const token = jwt.sign({ user: user }, config.jwt.secretKey, {});
      return res.json({ token: token, user: user });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async getAllCondominios(req, res) {
    try {
      const list = await db.getAllCondominios();
      return res.status(200).json(list);
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async getDashboard(req, res) {
    try {
      const [
        count_condominio,
        count_apartamentos,
        count_moradores,
        condominios_dia,
        condominios_localidade
      ] = await Promise.all([
        db.getCountCondominio(),
        db.getCountApartamentos(),
        db.getCountMoradores(),
        db.getCondominiosDia(),
        db.getCondominiosLocalidade()
      ]);

      return res.status(200).json({count_condominio, count_apartamentos, count_moradores, condominios_dia, condominios_localidade});
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async getSummary(req, res) {
    try {
      const { typeAccess, id } = req.session.user;
      let summary = {};
      
      if (typeAccess === 'Sindico') {
        summary = await db.getSyndicSummary(id);
      } else if (typeAccess === 'Morador') {
        // id_condominio opcional: dentro de um condomínio, escopa o resumo a ele;
        // na tela "Resumo Geral" (sem o param) agrega todos os condomínios.
        summary = await db.getResidentSummary(id, req.query.id_condominio);
      }

      return res.status(200).json(summary);
    } catch (err) {
      console.error('[getSummary Error]', err);
      return res.status(500).json({ message: err.message });
    }
  },

  async getMeusEventos(req, res) {
    try {
      const eventos = await dbAcessos.getMeusEventos(req.session.user.id, req.query.limit);
      return res.status(200).json(eventos);
    } catch (err) {
      console.error('[getMeusEventos Error]', err);
      return res.status(500).json({ message: err.message });
    }
  },

};