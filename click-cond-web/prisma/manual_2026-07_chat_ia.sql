-- Assistente IA (RAG) — tabelas de embeddings e histórico de conversa.
-- Migração MANUAL (Railway = MySQL 8; não roda `prisma db push`).
--
-- Rodar UMA vez no banco de produção ANTES de subir o deploy que inclui o
-- módulo chat-ia. Sem estas tabelas, POST /chat-ia/perguntar responde 500.
--
-- As duas usam CREATE TABLE IF NOT EXISTS, então reexecutar é seguro.
-- Mesmo DDL que já existe no backend Express (click-cond-api/schema.sql):
-- se o condomínio já rodou por lá, as tabelas podem existir e o script é no-op.

CREATE TABLE IF NOT EXISTS Rag_Embeddings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_condominio INT NOT NULL,
  source_type VARCHAR(20) NOT NULL,   -- 'ata' | 'documento'
  source_id INT NOT NULL,             -- Documentos.id
  chunk_index INT NOT NULL,
  chunk_text TEXT NOT NULL,
  embedding JSON NOT NULL,            -- vetor float[768] (text-embedding-004)
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_rag_cond (id_condominio),
  INDEX idx_rag_source (id_condominio, source_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS Chat_Ia_Historico (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_condominio INT NOT NULL,
  id_user INT NOT NULL,
  papel VARCHAR(12) NOT NULL,         -- 'user' | 'assistant'
  mensagem TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_chatia_cond_user (id_condominio, id_user)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
