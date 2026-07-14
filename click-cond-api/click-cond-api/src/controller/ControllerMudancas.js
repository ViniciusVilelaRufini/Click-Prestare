const db = require('../database/DB_Mudancas.js');

module.exports = {
  async insert(req, res) {
    try {
      await db.insert(req.body.id_condominio, req.body.mudanca, req.session.user.id);
      return res.json();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async getAll(req, res) {
    try {
      const user = req.session.user;
      const id_condominio = req.query.id_condominio;

      if (user.typeAccess != 'Morador') {
        const result = await db.getAll(id_condominio, req.query.offset, null);
        return res.status(200).json(result);
      } else {
        const dbAptos = require('../database/DB_Apartamento.js');
        const userAptos = await dbAptos.getApartmentsByUser(user.id, id_condominio);
        
        let id_apto = req.query.id_apto;
        if (id_apto && !userAptos.includes(parseInt(id_apto))) {
           return res.status(403).json({ message: "Acesso negado." });
        }
        
        if (!id_apto) id_apto = userAptos[0];

        const result = await db.getAll(id_condominio, req.query.offset, id_apto);
        return res.status(200).json(result);
      }
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async remove(req, res) {
    try {
      const user = req.session.user;
      const id = req.body.id;

      if (user.typeAccess === 'Morador') {
        const existing = await db.getById(id); // Check if getById exists
        if (!existing) return res.status(404).json({ message: "Mudança não encontrada." });
        
        const dbAptos = require('../database/DB_Apartamento.js');
        const userAptos = await dbAptos.getApartmentsByUser(user.id, existing.id_condominio);
        if (!userAptos.includes(existing.id_apto)) {
          return res.status(403).json({ message: "Acesso negado." });
        }
      }

      await db.remove(id);
      return res.json();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async update(req, res) {
    try {
      const user = req.session.user;
      const { id_condominio, mudanca } = req.body;

      if (user.typeAccess === 'Morador') {
        const existing = await db.getById(mudanca.id);
        if (!existing) return res.status(404).json({ message: "Mudança não encontrada." });
        
        const dbAptos = require('../database/DB_Apartamento.js');
        const userAptos = await dbAptos.getApartmentsByUser(user.id, id_condominio);
        if (!userAptos.includes(existing.id_apto)) {
          return res.status(403).json({ message: "Acesso negado." });
        }
      }

      await db.update(id_condominio, mudanca);
      return res.json();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async updateStatus(req, res) {
    console.log(111);
    try {
      await db.updateStatus(req.body.id_condominio, req.body.id, req.body.isAccept, req.body.motivo_recusa);
      return res.json();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async get(req, res) {
    try {
      const user = req.session.user;
      const result = await db.get(req.query.id_condominio, req.query.id);

      if (!result) return res.status(404).json({ message: "Mudança não encontrada." });

      // Enforce isolation for residents.
      // A query do get() devolve a coluna do apartamento como `apto_id`
      // (apto.id as apto_id), então validamos por result.apto_id — usar
      // result.id_apto (inexistente) causava 403 indevido pro morador.
      if (user.typeAccess === 'Morador') {
        const dbAptos = require('../database/DB_Apartamento.js');
        const userAptos = await dbAptos.getApartmentsByUser(user.id, req.query.id_condominio);

        if (!userAptos.includes(result.apto_id)) {
          return res.status(403).json({ message: "Acesso negado: Esta mudança não pertence ao seu apartamento." });
        }
      }

      return res.status(200).json(result);
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },


};