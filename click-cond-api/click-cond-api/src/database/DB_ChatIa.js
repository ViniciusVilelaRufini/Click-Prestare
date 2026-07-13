const db = require('./MySQL.js');

/**
 * Acesso às tabelas do Assistente IA:
 *  - Rag_Embeddings     → trechos vetorizados de atas/documentos (busca semântica)
 *  - Chat_Ia_Historico  → histórico de conversas por usuário/condomínio
 *
 * Consultas parametrizadas (queryParam) para evitar SQL injection nos textos.
 */
module.exports = {
  // --- Rag_Embeddings ---------------------------------------------------------

  /**
   * Remove todos os embeddings de um documento (usado antes de reindexar).
   */
  deleteEmbeddingsBySource: async function (idCondominio, sourceId) {
    const query = `delete from Rag_Embeddings where id_condominio=? and source_id=?`;
    await db.queryParam(query, [idCondominio, sourceId]);
  },

  /**
   * Remove embeddings de um documento apenas pelo id do documento
   * (usado no delete, onde não temos o id_condominio à mão).
   */
  deleteEmbeddingsByDocId: async function (sourceId) {
    const query = `delete from Rag_Embeddings where source_id=?`;
    await db.queryParam(query, [sourceId]);
  },

  /**
   * Remove TODOS os embeddings do condomínio (reindex completo).
   */
  deleteEmbeddingsByCond: async function (idCondominio) {
    const query = `delete from Rag_Embeddings where id_condominio=?`;
    await db.queryParam(query, [idCondominio]);
  },

  /**
   * Insere os chunks + embeddings de um documento.
   * @param {Array<{chunk_index:number, chunk_text:string, embedding:number[]}>} chunks
   */
  insertEmbeddings: async function (idCondominio, sourceType, sourceId, chunks) {
    if (!chunks || chunks.length === 0) return;
    const query = `insert into Rag_Embeddings
      (id_condominio, source_type, source_id, chunk_index, chunk_text, embedding)
      values (?, ?, ?, ?, ?, ?)`;
    for (const c of chunks) {
      await db.queryParam(query, [
        idCondominio,
        sourceType,
        sourceId,
        c.chunk_index,
        c.chunk_text,
        JSON.stringify(c.embedding),
      ]);
    }
  },

  /**
   * Retorna todos os embeddings do condomínio para a busca por similaridade
   * (feita em memória no RagService). Volume esperado: centenas de linhas/condo.
   */
  getEmbeddingsByCond: async function (idCondominio) {
    const query = `select source_type, source_id, chunk_index, chunk_text, embedding
                   from Rag_Embeddings where id_condominio=?`;
    const { results } = await db.queryParam(query, [idCondominio]);
    return results.map((r) => ({
      source_type: r.source_type,
      source_id: r.source_id,
      chunk_index: r.chunk_index,
      chunk_text: r.chunk_text,
      // MySQL JSON pode vir como string ou já parseado dependendo do driver.
      embedding: typeof r.embedding === 'string' ? JSON.parse(r.embedding) : r.embedding,
    }));
  },

  countEmbeddings: async function (idCondominio) {
    const query = `select count(*) as total from Rag_Embeddings where id_condominio=?`;
    const { results } = await db.queryParam(query, [idCondominio]);
    return results[0] ? results[0].total : 0;
  },

  // --- Chat_Ia_Historico ------------------------------------------------------

  salvarTurno: async function (idCondominio, idUser, papel, mensagem) {
    const query = `insert into Chat_Ia_Historico (id_condominio, id_user, papel, mensagem)
                   values (?, ?, ?, ?)`;
    await db.queryParam(query, [idCondominio, idUser, papel, mensagem]);
  },

  /**
   * Últimos N turnos (ordem cronológica) de um usuário nesse condomínio.
   */
  getHistoricoRecente: async function (idCondominio, idUser, limit = 12) {
    const query = `select papel, mensagem from Chat_Ia_Historico
                   where id_condominio=? and id_user=?
                   order by id desc limit ?`;
    const { results } = await db.queryParam(query, [idCondominio, idUser, limit]);
    return results.reverse();
  },
};
