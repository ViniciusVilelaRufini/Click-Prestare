-- Verificação de 2026-11-24-consentimentos-set-null.sql. SÓ LEITURA.
-- Esperado: cada linha com ok = 1 (a contagem do fim é só informativa).
-- Todo ok sai 0 ou 1, nunca NULL.

-- 1. id_user anulável.
SELECT 'Consentimentos.id_user INT NULL' AS item,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Consentimentos' AND COLUMN_NAME = 'id_user'
      AND DATA_TYPE = 'int' AND IS_NULLABLE = 'YES') AS ok;

-- 2. Exatamente UMA FK em id_user -> Users, chamada fk_consent_user, ON DELETE SET NULL.
SELECT 'fk id_user -> Users: so fk_consent_user, SET NULL' AS item,
  COALESCE(COUNT(*) = 1 AND MAX(rc.CONSTRAINT_NAME) = 'fk_consent_user' AND MAX(rc.DELETE_RULE) = 'SET NULL', 0) AS ok,
  GROUP_CONCAT(CONCAT(rc.CONSTRAINT_NAME, ':', rc.DELETE_RULE, '/', rc.UPDATE_RULE)) AS fks
  FROM information_schema.KEY_COLUMN_USAGE kcu
  JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
    ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
   AND rc.TABLE_NAME = kcu.TABLE_NAME
   AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
 WHERE kcu.TABLE_SCHEMA = DATABASE()
   AND kcu.TABLE_NAME = 'Consentimentos'
   AND kcu.COLUMN_NAME = 'id_user'
   AND kcu.REFERENCED_TABLE_NAME = 'Users';

-- 3. O índice que serve à FK continua.
SELECT 'idx_consent_user_tipo (id_user, tipo, registrado_em)' AS item,
  COALESCE(GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'id_user,tipo,registrado_em', 0) AS ok
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Consentimentos' AND INDEX_NAME = 'idx_consent_user_tipo';

-- 4. Informativo: provas guardadas de contas já excluídas (0 logo depois de aplicar).
SELECT COUNT(*) AS consentimentos_sem_conta FROM `Consentimentos` WHERE id_user IS NULL;
