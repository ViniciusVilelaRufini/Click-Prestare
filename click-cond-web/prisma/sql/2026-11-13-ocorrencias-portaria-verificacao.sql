-- Verificação de 2026-11-13-ocorrencias-portaria.sql. Esperado: as oito linhas com ok = 1.
SELECT 'Ocorrencias.origem VARCHAR(12) NULL' AS item,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Ocorrencias' AND COLUMN_NAME = 'origem'
      AND DATA_TYPE = 'varchar' AND CHARACTER_MAXIMUM_LENGTH = 12 AND IS_NULLABLE = 'YES') AS ok
UNION ALL
SELECT 'Ocorrencias.id_funcionario_portaria INT NULL',
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Ocorrencias' AND COLUMN_NAME = 'id_funcionario_portaria'
      AND DATA_TYPE = 'int' AND IS_NULLABLE = 'YES')
UNION ALL
SELECT 'fk_oco_func_portaria (SET NULL)',
  (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'Ocorrencias'
      AND CONSTRAINT_NAME = 'fk_oco_func_portaria' AND REFERENCED_TABLE_NAME = 'Funcionarios_Portaria'
      AND DELETE_RULE = 'SET NULL')
UNION ALL
SELECT 'OcorrenciaMensagens.id_usuario aceita NULL',
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'OcorrenciaMensagens' AND COLUMN_NAME = 'id_usuario'
      AND DATA_TYPE = 'int' AND IS_NULLABLE = 'YES')
UNION ALL
SELECT 'fk_msg_user continua (Users)',
  (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'OcorrenciaMensagens'
      AND CONSTRAINT_NAME = 'fk_msg_user' AND REFERENCED_TABLE_NAME = 'Users')
UNION ALL
SELECT 'OcorrenciaMensagens.id_funcionario_portaria INT NULL',
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'OcorrenciaMensagens' AND COLUMN_NAME = 'id_funcionario_portaria'
      AND DATA_TYPE = 'int' AND IS_NULLABLE = 'YES')
UNION ALL
SELECT 'fk_msg_func_portaria (SET NULL)',
  (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'OcorrenciaMensagens'
      AND CONSTRAINT_NAME = 'fk_msg_func_portaria' AND REFERENCED_TABLE_NAME = 'Funcionarios_Portaria'
      AND DELETE_RULE = 'SET NULL')
UNION ALL
SELECT 'OcorrenciaMensagens.nome_autor VARCHAR(120) NULL',
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'OcorrenciaMensagens' AND COLUMN_NAME = 'nome_autor'
      AND DATA_TYPE = 'varchar' AND CHARACTER_MAXIMUM_LENGTH = 120 AND IS_NULLABLE = 'YES');
