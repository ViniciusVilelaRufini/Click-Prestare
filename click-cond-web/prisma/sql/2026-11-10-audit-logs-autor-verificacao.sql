-- Verificação de 2026-11-10-audit-logs-autor.sql. Só leitura.
-- Rodar depois da migração e ANTES do deploy do código.

-- 1. Esperado: autor_id (int, YES/NULL) e autor_tipo (varchar(30), YES/NULL), logo após usuario_email.
SHOW COLUMNS FROM `audit_logs` WHERE Field IN ('usuario_email', 'autor_id', 'autor_tipo');

-- 2. Esperado: PRIMARY, idx_audit_created (created_at) e idx_audit_condo_created
--    (Seq_in_index 1 = id_condominio, 2 = created_at). idx_audit_condo NÃO deve aparecer.
SHOW INDEX FROM `audit_logs`;

-- 3. Mesma conferência em uma linha: esperado colunas_novas = 2, indice_composto = 2, indice_antigo = 0.
SELECT
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs'
      AND COLUMN_NAME IN ('autor_id', 'autor_tipo') AND IS_NULLABLE = 'YES') AS colunas_novas,
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs'
      AND INDEX_NAME = 'idx_audit_condo_created') AS indice_composto,
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs'
      AND INDEX_NAME = 'idx_audit_condo') AS indice_antigo;

-- 4. A listagem da auditoria deve usar o índice composto (key = idx_audit_condo_created, sem "Using filesort").
--    Troque 1 por um id_condominio existente.
EXPLAIN SELECT id FROM `audit_logs` WHERE id_condominio = 1 ORDER BY created_at DESC LIMIT 50;

-- 5. Depois do deploy: registros novos passam a vir com autor (antigos seguem NULL).
SELECT id, id_condominio, usuario_nome, autor_id, autor_tipo, acao, modulo, created_at
FROM `audit_logs` ORDER BY id DESC LIMIT 10;
