const RagService = require('../services/RagService');

module.exports = {
  /**
   * POST /chat-ia/perguntar
   * body: { id_condominio, pergunta }
   * O escopo dos dados é aplicado a partir de req.session.user (papel + id).
   */
  async perguntar(req, res) {
    try {
      const idCondominio = req.body.id_condominio;
      const pergunta = (req.body.pergunta || '').toString().trim();
      const user = req.session.user;

      if (!idCondominio) {
        return res.status(400).json({ message: 'id_condominio é obrigatório.' });
      }
      if (!pergunta) {
        return res.status(400).json({ message: 'A pergunta não pode ser vazia.' });
      }

      const resposta = await RagService.responder(idCondominio, user, pergunta);
      return res.status(200).json({ resposta });
    } catch (err) {
      console.error('[ChatIa] perguntar erro:', err.message);
      return res
        .status(500)
        .json({ message: 'Não consegui responder agora. Tente novamente em instantes.' });
    }
  },

  /**
   * POST /chat-ia/reindex
   * body: { id_condominio }
   * Reprocessa atas/documentos do condomínio para a busca semântica. Só síndico.
   */
  async reindex(req, res) {
    try {
      const idCondominio = req.body.id_condominio;
      if (!idCondominio) {
        return res.status(400).json({ message: 'id_condominio é obrigatório.' });
      }
      const resumo = await RagService.reindexCondominio(idCondominio);
      return res.status(200).json({ ok: true, ...resumo });
    } catch (err) {
      console.error('[ChatIa] reindex erro:', err.message);
      return res.status(500).json({ message: err.message });
    }
  },
};
