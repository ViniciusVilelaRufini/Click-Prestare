const db = require('../database/DB_Acessos.js');
const dbAptos = require('../database/DB_Apartamento.js');

module.exports = {
  // GET /facial/acessos/visitante/:id?limit=5
  // Últimos acessos do visitante (entrada/saída + método + horário) para o app.
  async getByVisitante(req, res) {
    try {
      const idVisitante = req.params.id;
      const limit = req.query.limit || 5;
      const user = req.session.user;

      // Tenant + isolamento por apartamento: o visitante precisa pertencer a um
      // apartamento vinculado ao usuário (mesma regra do getAll de visitantes).
      const visitante = await db.getCondominioByVisitante(idVisitante);
      if (!visitante) {
        return res.status(200).json([]);
      }
      const userAptos = await dbAptos.getApartmentsByUser(user.id, visitante.id_condominio);
      if (userAptos.length === 0 || !userAptos.includes(parseInt(visitante.id_apartamento))) {
        console.warn(`[SECURITY] User ${user.id} (${user.typeAccess}) tentou ver acessos do visitante ${idVisitante} sem permissão.`);
        return res.status(403).json({ message: 'Acesso negado: este visitante não pertence a você.' });
      }

      const acessos = await db.getByVisitante(idVisitante, limit);
      return res.status(200).json(acessos);
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },
};
