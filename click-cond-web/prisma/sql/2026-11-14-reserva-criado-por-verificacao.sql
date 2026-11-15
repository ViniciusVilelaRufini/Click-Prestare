-- Verificação de 2026-11-14-reserva-criado-por.sql. Esperado: a linha com ok = 1.
SELECT 'Areas_Sociais_Agendamentos.criado_por_nome VARCHAR(120) NULL' AS item,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Areas_Sociais_Agendamentos' AND COLUMN_NAME = 'criado_por_nome'
      AND DATA_TYPE = 'varchar' AND CHARACTER_MAXIMUM_LENGTH = 120 AND IS_NULLABLE = 'YES') AS ok;
