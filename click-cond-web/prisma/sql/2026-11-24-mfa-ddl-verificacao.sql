-- Verificação de 2026-11-24-mfa-ddl.sql. SÓ LEITURA.
-- Esperado: cada linha com ok = 1. Todo ok sai 0 ou 1, nunca NULL. Os SHOW
-- CREATE TABLE do fim são informativos (comparar com o CREATE do script).

-- mfa_challenges ---------------------------------------------------------------

-- 1. A tabela existe.
SELECT 'mfa_challenges existe' AS item,
  (SELECT COUNT(*) FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mfa_challenges') = 1 AS ok;

-- 2. Colunas: exatamente as do schema (nome:tipo:anulável).
SELECT 'mfa_challenges: colunas iguais ao schema' AS item,
  COALESCE(GROUP_CONCAT(CONCAT(COLUMN_NAME, ':', COLUMN_TYPE, ':', IS_NULLABLE) ORDER BY ORDINAL_POSITION)
    = 'id:int:NO,id_user:int:NO,token:char(36):NO,code_hash:varchar(255):NO,tentativas:int:NO,expires_at:datetime:NO,created_at:datetime:NO', 0) AS ok,
  GROUP_CONCAT(CONCAT(COLUMN_NAME, ':', COLUMN_TYPE, ':', IS_NULLABLE) ORDER BY ORDINAL_POSITION) AS colunas
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mfa_challenges';

-- 3. Índice PRIMARY (id) único.
SELECT 'mfa_challenges.PRIMARY (id)' AS item,
  COALESCE(GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'id' AND MAX(NON_UNIQUE) = 0, 0) AS ok
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mfa_challenges' AND INDEX_NAME = 'PRIMARY';

-- 4. Índice uni_mfa_challenges_token (token) único.
SELECT 'mfa_challenges.uni_mfa_challenges_token (token)' AS item,
  COALESCE(GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'token' AND MAX(NON_UNIQUE) = 0, 0) AS ok
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mfa_challenges' AND INDEX_NAME = 'uni_mfa_challenges_token';

-- 5. Índice idx_mfa_challenges_token (token).
SELECT 'mfa_challenges.idx_mfa_challenges_token (token)' AS item,
  COALESCE(GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'token' AND MAX(NON_UNIQUE) = 1, 0) AS ok
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mfa_challenges' AND INDEX_NAME = 'idx_mfa_challenges_token';

-- 6. Índice idx_mfa_challenges_user_exp (id_user,expires_at).
SELECT 'mfa_challenges.idx_mfa_challenges_user_exp (id_user,expires_at)' AS item,
  COALESCE(GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'id_user,expires_at' AND MAX(NON_UNIQUE) = 1, 0) AS ok
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mfa_challenges' AND INDEX_NAME = 'idx_mfa_challenges_user_exp';

-- 7. FK fk_mfa_challenges_user: id_user -> Users ON DELETE CASCADE.
SELECT 'mfa_challenges.fk_mfa_challenges_user -> Users CASCADE' AS item,
  (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'mfa_challenges' AND CONSTRAINT_NAME = 'fk_mfa_challenges_user'
      AND REFERENCED_TABLE_NAME = 'Users' AND DELETE_RULE = 'CASCADE') = 1 AS ok;

-- user_trusted_devices ---------------------------------------------------------------

-- 8. A tabela existe.
SELECT 'user_trusted_devices existe' AS item,
  (SELECT COUNT(*) FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_trusted_devices') = 1 AS ok;

-- 9. Colunas: exatamente as do schema (nome:tipo:anulável).
SELECT 'user_trusted_devices: colunas iguais ao schema' AS item,
  COALESCE(GROUP_CONCAT(CONCAT(COLUMN_NAME, ':', COLUMN_TYPE, ':', IS_NULLABLE) ORDER BY ORDINAL_POSITION)
    = 'id:int:NO,id_user:int:NO,device_hash:char(64):NO,user_agent:varchar(255):YES,ip_address:varchar(45):YES,expires_at:datetime:NO,created_at:datetime:NO', 0) AS ok,
  GROUP_CONCAT(CONCAT(COLUMN_NAME, ':', COLUMN_TYPE, ':', IS_NULLABLE) ORDER BY ORDINAL_POSITION) AS colunas
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_trusted_devices';

-- 10. Índice PRIMARY (id) único.
SELECT 'user_trusted_devices.PRIMARY (id)' AS item,
  COALESCE(GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'id' AND MAX(NON_UNIQUE) = 0, 0) AS ok
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_trusted_devices' AND INDEX_NAME = 'PRIMARY';

-- 11. Índice uni_user_trusted_devices_hash (device_hash) único.
SELECT 'user_trusted_devices.uni_user_trusted_devices_hash (device_hash)' AS item,
  COALESCE(GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'device_hash' AND MAX(NON_UNIQUE) = 0, 0) AS ok
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_trusted_devices' AND INDEX_NAME = 'uni_user_trusted_devices_hash';

-- 12. Índice idx_user_trusted_devices_user_exp (id_user,expires_at).
SELECT 'user_trusted_devices.idx_user_trusted_devices_user_exp (id_user,expires_at)' AS item,
  COALESCE(GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'id_user,expires_at' AND MAX(NON_UNIQUE) = 1, 0) AS ok
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_trusted_devices' AND INDEX_NAME = 'idx_user_trusted_devices_user_exp';

-- 13. FK fk_user_trusted_devices_user: id_user -> Users ON DELETE CASCADE.
SELECT 'user_trusted_devices.fk_user_trusted_devices_user -> Users CASCADE' AS item,
  (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'user_trusted_devices' AND CONSTRAINT_NAME = 'fk_user_trusted_devices_user'
      AND REFERENCED_TABLE_NAME = 'Users' AND DELETE_RULE = 'CASCADE') = 1 AS ok;

-- Informativo.
SHOW CREATE TABLE `mfa_challenges`;
SHOW CREATE TABLE `user_trusted_devices`;
