-- Verificação de 2026-11-15-assembleia-robusta.sql. SÓ LEITURA.
-- Esperado: cada linha com ok = 1 (as contagens do fim são só informativas).
-- Todo ok sai 0 ou 1, nunca NULL.

-- 1 a 4. Assembleias: colunas novas, anuláveis.
SELECT 'Assembleias.finalizada_em DATETIME NULL' AS item,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Assembleias' AND COLUMN_NAME = 'finalizada_em'
      AND DATA_TYPE = 'datetime' AND IS_NULLABLE = 'YES') AS ok;
SELECT 'Assembleias.finalizada_por INT NULL' AS item,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Assembleias' AND COLUMN_NAME = 'finalizada_por'
      AND DATA_TYPE = 'int' AND IS_NULLABLE = 'YES') AS ok;
SELECT 'Assembleias.id_documento_ata INT NULL' AS item,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Assembleias' AND COLUMN_NAME = 'id_documento_ata'
      AND DATA_TYPE = 'int' AND IS_NULLABLE = 'YES') AS ok;
SELECT 'Assembleias.apuracao_hash CHAR(64) NULL' AS item,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Assembleias' AND COLUMN_NAME = 'apuracao_hash'
      AND DATA_TYPE = 'char' AND CHARACTER_MAXIMUM_LENGTH = 64 AND IS_NULLABLE = 'YES') AS ok;

-- 5 e 6. Votacoes.
SELECT 'Votacoes.encerrada_em DATETIME NULL' AS item,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Votacoes' AND COLUMN_NAME = 'encerrada_em'
      AND DATA_TYPE = 'datetime' AND IS_NULLABLE = 'YES') AS ok;
SELECT 'Votacoes.somente_proprietarios TINYINT NOT NULL DEFAULT 0' AS item,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Votacoes' AND COLUMN_NAME = 'somente_proprietarios'
      AND DATA_TYPE = 'tinyint' AND IS_NULLABLE = 'NO' AND COLUMN_DEFAULT = '0') AS ok;

-- 7 a 10. Votacoes_Usuarios: retrato e trilha.
SELECT 'Votacoes_Usuarios.tipo_vinculo VARCHAR(20) NULL' AS item,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Votacoes_Usuarios' AND COLUMN_NAME = 'tipo_vinculo'
      AND DATA_TYPE = 'varchar' AND CHARACTER_MAXIMUM_LENGTH = 20 AND IS_NULLABLE = 'YES') AS ok;
SELECT 'Votacoes_Usuarios.nome_votante VARCHAR(255) NULL' AS item,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Votacoes_Usuarios' AND COLUMN_NAME = 'nome_votante'
      AND DATA_TYPE = 'varchar' AND CHARACTER_MAXIMUM_LENGTH = 255 AND IS_NULLABLE = 'YES') AS ok;
SELECT 'Votacoes_Usuarios.rotulo_unidade VARCHAR(120) NULL' AS item,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Votacoes_Usuarios' AND COLUMN_NAME = 'rotulo_unidade'
      AND DATA_TYPE = 'varchar' AND CHARACTER_MAXIMUM_LENGTH = 120 AND IS_NULLABLE = 'YES') AS ok;
SELECT 'Votacoes_Usuarios.substituido_em DATETIME NULL' AS item,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Votacoes_Usuarios' AND COLUMN_NAME = 'substituido_em'
      AND DATA_TYPE = 'datetime' AND IS_NULLABLE = 'YES') AS ok;

-- 11. id_user anulável.
SELECT 'Votacoes_Usuarios.id_user INT NULL' AS item,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Votacoes_Usuarios' AND COLUMN_NAME = 'id_user'
      AND DATA_TYPE = 'int' AND IS_NULLABLE = 'YES') AS ok;

-- 11. Exatamente UMA FK em id_user -> Users, chamada fk_vu_user, ON DELETE SET NULL.
SELECT 'fk id_user -> Users: so fk_vu_user, SET NULL' AS item,
  COALESCE(COUNT(*) = 1 AND MAX(rc.CONSTRAINT_NAME) = 'fk_vu_user' AND MAX(rc.DELETE_RULE) = 'SET NULL', 0) AS ok,
  GROUP_CONCAT(CONCAT(rc.CONSTRAINT_NAME, ':', rc.DELETE_RULE, '/', rc.UPDATE_RULE)) AS fks
  FROM information_schema.KEY_COLUMN_USAGE kcu
  JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
    ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
   AND rc.TABLE_NAME = kcu.TABLE_NAME
   AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
 WHERE kcu.TABLE_SCHEMA = DATABASE()
   AND kcu.TABLE_NAME = 'Votacoes_Usuarios'
   AND kcu.COLUMN_NAME = 'id_user'
   AND kcu.REFERENCED_TABLE_NAME = 'Users';

-- 12. As outras FKs não mudaram: voto -> opção em cascata, voto -> apartamento SET NULL,
--     opção -> votação em cascata.
SELECT 'fks de voto e opcao inalteradas' AS item,
  COUNT(*) = 3 AS ok,
  GROUP_CONCAT(CONCAT(CONSTRAINT_NAME, ':', DELETE_RULE) ORDER BY CONSTRAINT_NAME) AS fks
  FROM information_schema.REFERENTIAL_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA = DATABASE()
   AND ((TABLE_NAME = 'Votacoes_Usuarios' AND CONSTRAINT_NAME = 'fk_vu_op' AND DELETE_RULE = 'CASCADE')
     OR (TABLE_NAME = 'Votacoes_Usuarios' AND CONSTRAINT_NAME = 'fk_vu_apto' AND DELETE_RULE = 'SET NULL')
     OR (TABLE_NAME = 'Votacoes_Opcoes' AND CONSTRAINT_NAME = 'fk_vo_vot' AND DELETE_RULE = 'CASCADE'));

-- 13. O índice de id_user (usado pela FK) continua.
SELECT 'indice fk_vu_user (id_user)' AS item,
  COALESCE(GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'id_user', 0) AS ok
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Votacoes_Usuarios' AND INDEX_NAME = 'fk_vu_user';

-- 14. Informativo: nada foi reescrito (logo após aplicar, tudo antigo fica NULL / 0).
SELECT
  (SELECT COUNT(*) FROM Assembleias) AS assembleias,
  (SELECT COUNT(*) FROM Assembleias WHERE finalizada_em IS NOT NULL) AS assembleias_finalizadas,
  (SELECT COUNT(*) FROM Votacoes) AS votacoes,
  (SELECT COUNT(*) FROM Votacoes WHERE encerrada_em IS NOT NULL) AS votacoes_encerradas,
  (SELECT COUNT(*) FROM Votacoes WHERE somente_proprietarios <> 0) AS votacoes_somente_proprietarios,
  (SELECT COUNT(*) FROM Votacoes_Usuarios) AS votos,
  (SELECT COUNT(*) FROM Votacoes_Usuarios WHERE tipo_vinculo IS NOT NULL) AS votos_com_retrato,
  (SELECT COUNT(*) FROM Votacoes_Usuarios WHERE substituido_em IS NOT NULL) AS votos_substituidos,
  (SELECT COUNT(*) FROM Votacoes_Usuarios WHERE id_user IS NULL) AS votos_sem_conta;
