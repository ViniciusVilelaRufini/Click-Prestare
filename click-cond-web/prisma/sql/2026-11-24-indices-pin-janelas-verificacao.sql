-- Verificação de 2026-11-24-indices-pin-janelas.sql. SÓ LEITURA.
-- Esperado: cada linha com ok = 1 (os EXPLAIN do fim são informativos: a coluna
-- key deve mostrar o índice novo). Todo ok sai 0 ou 1, nunca NULL.

-- 1.
SELECT 'visitas.idx_visita_pin_saida (codigo_acesso,data_saida)' AS item,
  COALESCE(GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'codigo_acesso,data_saida', 0) AS ok
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'visitas' AND INDEX_NAME = 'idx_visita_pin_saida';

-- 2.
SELECT 'visitas.idx_visita_inicio (data_hora_inicio)' AS item,
  COALESCE(GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'data_hora_inicio', 0) AS ok
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'visitas' AND INDEX_NAME = 'idx_visita_inicio';

-- 3.
SELECT 'visitas.idx_visita_termino (data_hora_termino)' AS item,
  COALESCE(GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'data_hora_termino', 0) AS ok
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'visitas' AND INDEX_NAME = 'idx_visita_termino';

-- 4.
SELECT 'Visitantes.idx_vis_pin_saida (codigo_acesso,data_saida)' AS item,
  COALESCE(GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'codigo_acesso,data_saida', 0) AS ok
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Visitantes' AND INDEX_NAME = 'idx_vis_pin_saida';

-- 5.
SELECT 'Visitantes.idx_vis_inicio (data_hora_inicio)' AS item,
  COALESCE(GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'data_hora_inicio', 0) AS ok
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Visitantes' AND INDEX_NAME = 'idx_vis_inicio';

-- 6.
SELECT 'Visitantes.idx_vis_termino (data_hora_termino)' AS item,
  COALESCE(GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'data_hora_termino', 0) AS ok
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Visitantes' AND INDEX_NAME = 'idx_vis_termino';

-- 7. Informativo: a busca do PIN único usa os índices novos.
EXPLAIN SELECT id FROM `visitas` WHERE codigo_acesso = '123456' AND data_saida IS NULL LIMIT 1;
EXPLAIN SELECT id FROM `Visitantes` WHERE codigo_acesso = '123456' AND data_saida IS NULL LIMIT 1;
