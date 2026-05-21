const db = require('../database/DB_Visitantes.js');
const dbAptos = require('../database/DB_Apartamento.js');

module.exports = {
  async insert(req, res) {
    try {
      const { id_condominio, visitante } = req.body;
      const user = req.session.user;

      // Validate apartment for residents during registration
      if (user.typeAccess === 'Morador') {
        const userAptos = await dbAptos.getApartmentsByUser(user.id, id_condominio);
        if (!userAptos.includes(parseInt(visitante.id_apartamento))) {
          return res.status(403).json({ message: "Acesso negado: Você só pode registrar visitantes para o seu próprio apartamento." });
        }
      }

      await db.insert(id_condominio, visitante, user.id);
      return res.json();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async getAll(req, res) {
    try {
      let id_apto = req.query.id_apto;
      const id_condominio = req.query.id_condominio;
      const user = req.session.user;

      let filterUserId = null;

      // Enforce data isolation for residents
      if (user.typeAccess === 'Morador') {
        filterUserId = user.id;

        if (id_condominio) {
          const userAptos = await dbAptos.getApartmentsByUser(user.id, id_condominio);
          
          if (id_apto && !userAptos.includes(parseInt(id_apto))) {
            console.warn(`[SECURITY] Resident ${user.id} attempted to access Apto ${id_apto} without permission.`);
            return res.status(403).json({ message: "Acesso negado: Este apartamento não pertence a você." });
          }

          if (!id_apto && userAptos.length > 0) {
            id_apto = userAptos[0];
          }
        }
      }

      const result = await db.getAll(id_condominio, req.query.offset || 0, id_apto, req.query.search, filterUserId);
      return res.status(200).json(result);
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async remove(req, res) {
    try {
      const user = req.session.user;
      const id = req.body.id;

      if (user.typeAccess === 'Morador') {
        const visitante = await db.getById(id); // I need to check if getById exists or use get
        if (!visitante) return res.status(404).json({ message: "Visitante não encontrado." });
        
        const userAptos = await dbAptos.getApartmentsByUser(user.id, visitante.id_condominio);
        if (!userAptos.includes(visitante.id_apartamento)) {
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
      const { id_condominio, visitante } = req.body;

      if (user.typeAccess === 'Morador') {
        const existing = await db.getById(visitante.id);
        if (!existing) return res.status(404).json({ message: "Visitante não encontrado." });
        
        const userAptos = await dbAptos.getApartmentsByUser(user.id, id_condominio);
        if (!userAptos.includes(existing.id_apartamento)) {
          return res.status(403).json({ message: "Acesso negado." });
        }
      }

      await db.update(id_condominio, visitante);
      return res.json();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async get(req, res) {
    try {
      const user = req.session.user;
      const result = await db.get(req.query.id_condominio, req.query.id);

      if (!result) return res.status(404).json({ message: "Visitante não encontrado." });

      if (user.typeAccess === 'Morador') {
        const userAptos = await dbAptos.getApartmentsByUser(user.id, req.query.id_condominio);
        if (!userAptos.includes(result.id_apartamento)) {
          return res.status(403).json({ message: "Acesso negado." });
        }
      }

      return res.status(200).json(result);
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async checkIn(req, res) {
    try {
      await db.checkIn(req.body.id);
      return res.json();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async checkOut(req, res) {
    try {
      await db.checkOut(req.body.id);
      return res.json();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },
};