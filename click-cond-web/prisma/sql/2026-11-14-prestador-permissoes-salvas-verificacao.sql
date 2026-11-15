-- Verificação de 2026-11-14-prestador-permissoes-salvas.sql. Esperado: a linha com ok = 1.
SELECT 'Prestadores_servico.permissoes_app_salvas TEXT NULL' AS item,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Prestadores_servico' AND COLUMN_NAME = 'permissoes_app_salvas'
      AND DATA_TYPE = 'text' AND IS_NULLABLE = 'YES') AS ok;

-- Leitura (não altera nada): quantos prestadores já têm permissões guardadas. Logo depois de aplicar, 0.
SELECT COUNT(*) AS prestadores_com_permissoes_salvas
FROM Prestadores_servico
WHERE permissoes_app_salvas IS NOT NULL;
