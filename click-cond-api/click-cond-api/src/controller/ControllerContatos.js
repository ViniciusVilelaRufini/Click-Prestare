const db = require('../database/DB_Contatos.js');

module.exports = {
  async getAll(req, res) {
    try {
      const list = await db.getAll(req.query.id_condominio);
      return res.status(200).json(list);
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async insert(req, res) {
    try {
      const c = req.body.contato || {};
      if (!c.nome || !c.categoria || !c.telefone) {
        return res.status(400).json({ message: 'Nome, categoria e telefone são obrigatórios.' });
      }
      await db.insert(req.body.id_condominio, c);
      return res.json();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async update(req, res) {
    try {
      const c = req.body.contato || {};
      if (!c.id) return res.status(400).json({ message: 'Contato inválido.' });
      if (!c.nome || !c.categoria || !c.telefone) {
        return res.status(400).json({ message: 'Nome, categoria e telefone são obrigatórios.' });
      }
      await db.update(req.body.id_condominio, c);
      return res.json();
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
