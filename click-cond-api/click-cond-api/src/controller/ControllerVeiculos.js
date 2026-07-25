const db = require('../database/DB_Veiculos.js');

// Erro de placa duplicada por condomínio (unique key un_veiculo_cond_placa).
function isDuplicatePlaca(err) {
  return err && err.code === 'ER_DUP_ENTRY' && /un_veiculo_cond_placa/.test(err.message || '');
}

module.exports = {
  /**
   * Lista os veículos do morador logado no condomínio informado.
   */
  async getAll(req, res) {
    try {
      const user = req.session.user;
      const idCondominio = req.query.id_condominio;
      const idMorador = await db.getMoradorId(user.id, idCondominio);
      if (!idMorador) return res.status(200).json([]);
      const list = await db.getAllByMorador(idMorador);
      return res.status(200).json(list);
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async insert(req, res) {
    try {
      const user = req.session.user;
      const { id_condominio, veiculo } = req.body;
      if (!veiculo || !veiculo.placa) {
        return res.status(400).json({ message: 'Placa é obrigatória.' });
      }
      const idMorador = await db.getMoradorId(user.id, id_condominio);
      if (!idMorador) {
        return res.status(403).json({ message: 'Você não é morador deste condomínio.' });
      }
      const id = await db.insert({ ...veiculo, id_morador: idMorador, id_condominio });
      // Tag opcional: o morador digita o código impresso na tag física.
      if (veiculo.tag_codigo !== undefined) {
        await db.vincularTag(id, id_condominio, veiculo.tag_codigo);
      }
      return res.status(201).json({ id });
    } catch (err) {
      if (isDuplicatePlaca(err)) {
        return res.status(409).json({ message: 'Já existe um veículo com essa placa neste condomínio.' });
      }
      if (err.message === 'TAG_EM_OUTRO_VEICULO') {
        return res.status(409).json({ message: 'Esta tag já está vinculada a outro veículo.' });
      }
      return res.status(500).json({ message: err.message });
    }
  },

  async update(req, res) {
    try {
      const user = req.session.user;
      const { id_condominio, veiculo } = req.body;
      if (!veiculo || !veiculo.id) return res.status(400).json({ message: 'Veículo inválido.' });
      const idMorador = await db.getMoradorId(user.id, id_condominio);
      if (!idMorador) return res.status(403).json({ message: 'Acesso negado.' });
      await db.update(veiculo, idMorador);
      if (veiculo.tag_codigo !== undefined) {
        await db.vincularTag(veiculo.id, id_condominio, veiculo.tag_codigo);
      }
      return res.json();
    } catch (err) {
      if (isDuplicatePlaca(err)) {
        return res.status(409).json({ message: 'Já existe um veículo com essa placa neste condomínio.' });
      }
      if (err.message === 'TAG_EM_OUTRO_VEICULO') {
        return res.status(409).json({ message: 'Esta tag já está vinculada a outro veículo.' });
      }
      return res.status(500).json({ message: err.message });
    }
  },

  async remove(req, res) {
    try {
      const user = req.session.user;
      const { id, id_condominio } = req.body;
      const idMorador = await db.getMoradorId(user.id, id_condominio);
      if (!idMorador) return res.status(403).json({ message: 'Acesso negado.' });
      await db.remove(id, idMorador);
      return res.json();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },
};
