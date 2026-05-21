const db = require('../database/DB_Encomendas.js');
const dbAptos = require('../database/DB_Apartamento.js');
const saveToAWS = require('../utils/saveToAWS');

module.exports = {
  /**
   * Lista encomendas para o síndico ou para o morador (filtrando pelo dele).
   */
  async getAll(req, res) {
    try {
      const { id_condominio, status } = req.query;
      let { bloco, apto } = req.query;
      const user = req.session.user;

      // Enforce data isolation for residents
      if (user.typeAccess === 'Morador') {
        const dbMoradores = require('../database/DB_Moradores');
        const conds = await dbMoradores.listCondominios(user.id);
        const currentCond = conds.find(c => c.id == id_condominio) || conds[0];
        
        if (!currentCond) return res.status(200).json([]);

        // Force filtering to their registered unit
        bloco = currentCond.apto_bloco;
        apto = currentCond.apto;
      }

      const result = await db.getAll(id_condominio, status, bloco, apto);
      return res.status(200).json(result);
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async insert(req, res) {
    try {
      const { encomenda, id_condominio } = req.body;
      encomenda.id_condominio = id_condominio;
      
      if (encomenda.photo != null) {
        const urlPhoto = await saveToAWS(encomenda.photo, `condominios/${id_condominio}/encomendas`, 'volume');
        encomenda.foto_volume = urlPhoto.url;
      }
      
      await db.insert(encomenda);
      return res.json();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async retirar(req, res) {
    try {
      const { id, retirado_por } = req.body;
      await db.retirar(id, retirado_por);
      return res.json();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async get(req, res) {
    try {
      const user = req.session.user;
      const result = await db.get(req.query.id);

      if (!result) return res.status(404).json({ message: "Encomenda não encontrada." });

      // Enforce isolation for residents
      if (user.typeAccess === 'Morador') {
        const dbMoradores = require('../database/DB_Moradores');
        const conds = await dbMoradores.listCondominios(user.id);
        const currentCond = conds.find(c => c.id == result.id_condominio);

        if (!currentCond || 
            result.destinatario_apto !== currentCond.apto || 
            (result.destinatario_bloco && result.destinatario_bloco !== currentCond.apto_bloco)) {
          return res.status(403).json({ message: "Acesso negado: Esta encomenda não pertence ao seu apartamento." });
        }
      }

      return res.status(200).json(result);
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  }
};
