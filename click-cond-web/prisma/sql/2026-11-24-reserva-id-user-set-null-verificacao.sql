-- Verificação de 2026-11-24-reserva-id-user-set-null.sql. SÓ LEITURA.
-- Esperado: cada linha com ok = 1 (a contagem do fim é só informativa).
-- Todo ok sai 0 ou 1, nunca NULL.

-- 1. id_user anulável.
SELECT 'Areas_Sociais_Agendamentos.id_user INT NULL' AS item,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Areas_Sociais_Agendamentos' AND COLUMN_NAME = 'id_user'
      AND DATA_TYPE = 'int' AND IS_NULLABLE = 'YES') AS ok;

-- 2. Exatamente UMA FK em id_user -> Users, chamada fk_asa_user, ON DELETE SET NULL.
SELECT 'fk id_user -> Users: so fk_asa_user, SET NULL' AS item,
  COALESCE(COUNT(*) = 1 AND MAX(rc.CONSTRAINT_NAME) = 'fk_asa_user' AND MAX(rc.DELETE_RULE) = 'SET NULL', 0) AS ok,
  GROUP_CONCAT(CONCAT(rc.CONSTRAINT_NAME, ':', rc.DELETE_RULE, '/', rc.UPDATE_RULE)) AS fks
  FROM information_schema.KEY_COLUMN_USAGE kcu
  JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
    ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
   AND rc.TABLE_NAME = kcu.TABLE_NAME
   AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
 WHERE kcu.TABLE_SCHEMA = DATABASE()
   AND kcu.TABLE_NAME = 'Areas_Sociais_Agendamentos'
   AND kcu.COLUMN_NAME = 'id_user'
   AND kcu.REFERENCED_TABLE_NAME = 'Users';

-- 3. O índice que serve à FK continua.
SELECT 'indice fk_asa_user (id_user)' AS item,
  COALESCE(GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'id_user', 0) AS ok
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Areas_Sociais_Agendamentos' AND INDEX_NAME = 'fk_asa_user';

-- 4. As outras duas FKs da tabela seguem em CASCADE (só id_user mudou).
SELECT 'fk_asa_apto e fk_asa_area: CASCADE' AS item,
  COALESCE(SUM(CONSTRAINT_NAME IN ('fk_asa_apto', 'fk_asa_area') AND DELETE_RULE = 'CASCADE') = 2, 0) AS ok
  FROM information_schema.REFERENTIAL_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'Areas_Sociais_Agendamentos';

-- 5. Informativo: reservas de donos que já excluíram a conta (0 logo depois de aplicar).
SELECT COUNT(*) AS reservas_sem_dono FROM `Areas_Sociais_Agendamentos` WHERE id_user IS NULL;
