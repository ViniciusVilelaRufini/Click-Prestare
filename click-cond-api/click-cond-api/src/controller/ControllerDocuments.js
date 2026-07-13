const db = require('../database/DB_Documents.js');
const saveToAWS = require('../utils/saveToAWS');
const RagService = require('../services/RagService');
const DB_ChatIa = require('../database/DB_ChatIa.js');

module.exports = {
  async insert(req, res) {
    try {
      if(req.body.documento.doc){
        const urlPhotoProfile = await saveToAWS(req.body.documento.doc, `condominios/${req.body.id_condominio}/docs`, req.body.documento.is_ata ? 'ata' : 'doc');
        req.body.documento.link_doc = urlPhotoProfile.url;
      }
      const insertId = await db.insert(req.body.id_condominio, req.body.documento);

      // Indexa o novo documento para o Assistente IA em background (fire-and-forget):
      // não trava a resposta ao usuário e falha de forma silenciosa se o Gemini estiver off.
      const doc = { id: insertId, nome: req.body.documento.nome, link_doc: req.body.documento.link_doc, is_ata: req.body.documento.is_ata };
      RagService.reindexDocumento(req.body.id_condominio, doc)
        .catch((e) => console.warn('[RAG] reindex do novo documento falhou:', e.message));

      return res.json();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async getAll(req, res) {
    try {
      const cond = await db.getAll(req.query.id_condominio, req.query.is_ata);
      return res.status(200).json(cond);
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async remove(req, res) {
    try {
      await db.remove(req.body.id);
      // Remove os embeddings desse documento do índice do Assistente IA.
      DB_ChatIa.deleteEmbeddingsByDocId(req.body.id).catch(() => {});
      return res.json();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

};