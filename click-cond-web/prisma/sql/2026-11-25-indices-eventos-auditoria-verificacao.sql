-- Verificação de 2026-11-25-indices-eventos-auditoria.sql (só leitura). Todo `ok` deve ser 1.
SELECT 'Encomendas (id_condominio, recebido_em)' AS item,
  COALESCE((SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Encomendas' AND INDEX_NAME = 'idx_enc_cond_recebido') = 'id_condominio,recebido_em', 0) AS ok
UNION ALL SELECT 'Ocorrencias (id_condominio, created_at)',
  COALESCE((SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Ocorrencias' AND INDEX_NAME = 'idx_oco_cond_created') = 'id_condominio,created_at', 0)
UNION ALL SELECT 'visitas (id_condominio, data_saida)',
  COALESCE((SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'visitas' AND INDEX_NAME = 'idx_visita_cond_saida') = 'id_condominio,data_saida', 0)
UNION ALL SELECT 'audit_logs (id_condominio, modulo, created_at)',
  COALESCE((SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs' AND INDEX_NAME = 'idx_audit_condo_modulo_created') = 'id_condominio,modulo,created_at', 0)
UNION ALL SELECT 'duplicados removidos',
  (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
     AND INDEX_NAME IN ('idx_enc_cond_status', 'idx_encomendas_cond_status', 'idx_ocorrencias_cond')) = 0
UNION ALL SELECT 'índices do schema mantidos',
  (SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
     AND ((TABLE_NAME = 'Encomendas' AND INDEX_NAME = 'Encomendas_id_condominio_status_idx')
       OR (TABLE_NAME = 'Ocorrencias' AND INDEX_NAME = 'Ocorrencias_id_condominio_idx'))) = 2;
