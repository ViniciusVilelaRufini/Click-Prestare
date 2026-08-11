-- =====================================================================
-- Migração do deploy ebe6b2a (rotas do app portadas do Express p/ NestJS).
--
-- Railway = MySQL 8 e NÃO roda `prisma db push`: o schema.prisma pode estar
-- à frente do banco real. Este script fecha essa diferença.
--
-- É IDEMPOTENTE: pode rodar quantas vezes quiser. As tabelas usam
-- CREATE TABLE IF NOT EXISTS; as colunas usam checagem via information_schema
-- + SQL dinâmico, porque o MySQL 8 não suporta `ADD COLUMN IF NOT EXISTS`.
--
-- Rode o arquivo INTEIRO, de uma vez.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Colunas em Users
--
-- fcm_token   -> exigido por POST /users/update-fcm-token. Sem ele NENHUM
--                push funciona (inclusive a autorização de portaria remota).
-- notif_*     -> exigidas por GET/POST /users/settings.
--
-- Default 1 nas notif_*: quem já existe passa a receber tudo, que é o
-- comportamento atual de fato (hoje ninguém tem preferência gravada).
-- ---------------------------------------------------------------------

SET @sql = (SELECT IF(EXISTS(
  SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Users' AND COLUMN_NAME = 'fcm_token'),
  'SELECT ''fcm_token: ja existia'' AS resultado',
  'ALTER TABLE Users ADD COLUMN fcm_token VARCHAR(500) NULL'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql = (SELECT IF(EXISTS(
  SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Users' AND COLUMN_NAME = 'notif_encomendas'),
  'SELECT ''notif_encomendas: ja existia'' AS resultado',
  'ALTER TABLE Users ADD COLUMN notif_encomendas TINYINT NOT NULL DEFAULT 1'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql = (SELECT IF(EXISTS(
  SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Users' AND COLUMN_NAME = 'notif_comunicados'),
  'SELECT ''notif_comunicados: ja existia'' AS resultado',
  'ALTER TABLE Users ADD COLUMN notif_comunicados TINYINT NOT NULL DEFAULT 1'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql = (SELECT IF(EXISTS(
  SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Users' AND COLUMN_NAME = 'notif_ocorrencias'),
  'SELECT ''notif_ocorrencias: ja existia'' AS resultado',
  'ALTER TABLE Users ADD COLUMN notif_ocorrencias TINYINT NOT NULL DEFAULT 1'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql = (SELECT IF(EXISTS(
  SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Users' AND COLUMN_NAME = 'notif_visitantes'),
  'SELECT ''notif_visitantes: ja existia'' AS resultado',
  'ALTER TABLE Users ADD COLUMN notif_visitantes TINYINT NOT NULL DEFAULT 1'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;


-- ---------------------------------------------------------------------
-- 2. Tabelas do Assistente IA (chat-ia)
--
-- Sem elas, POST /chat-ia/perguntar responde 500. As demais rotas do
-- deploy não dependem destas tabelas.
--
-- Sem FK para Documentos de propósito: o embedding é cache derivado e a
-- exclusão do documento é tratada no service.
-- ---------------------------------------------------------------------

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


-- ---------------------------------------------------------------------
-- 3. Conferência final — as duas queries devem devolver 5 e 2.
-- ---------------------------------------------------------------------

SELECT COUNT(*) AS colunas_users_ok_esperado_5
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Users'
  AND COLUMN_NAME IN ('fcm_token','notif_encomendas','notif_comunicados',
                      'notif_ocorrencias','notif_visitantes');

SELECT COUNT(*) AS tabelas_chatia_ok_esperado_2
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('Rag_Embeddings','Chat_Ia_Historico');
