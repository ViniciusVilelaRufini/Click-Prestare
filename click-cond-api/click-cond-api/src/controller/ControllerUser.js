const dbUsers = require('../database/DB_Users');

module.exports = {
  async updateFcmToken(req, res) {
    try {
      const { fcm_token } = req.body;
      if (!fcm_token) {
        return res.status(400).json({ message: 'FCM Token is required' });
      }
      await dbUsers.updateFcmToken(req.session.user.id, fcm_token);
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async getNotificationSettings(req, res) {
    try {
      const user = await dbUsers.getUserInfo(req.session.user.id);
      return res.json({
        notif_encomendas: user.notif_encomendas,
        notif_comunicados: user.notif_comunicados,
        notif_ocorrencias: user.notif_ocorrencias,
        notif_visitantes: user.notif_visitantes,
      });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async deleteAccount(req, res) {
    try {
      await dbUsers.deleteAccount(req.session.user.id);
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async updateNotificationSettings(req, res) {
    try {
      const { notif_encomendas, notif_comunicados, notif_ocorrencias, notif_visitantes } = req.body;
      const query = `UPDATE Users SET 
                      notif_encomendas = ?, 
                      notif_comunicados = ?, 
                      notif_ocorrencias = ?,
                      notif_visitantes = ?
                    WHERE id = ?`;
      const db = require('../database/MySQL.js');
      await db.queryParam(query, [
        notif_encomendas ? 1 : 0,
        notif_comunicados ? 1 : 0,
        notif_ocorrencias ? 1 : 0,
        notif_visitantes ? 1 : 0,
        req.session.user.id
      ]);
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },
};
