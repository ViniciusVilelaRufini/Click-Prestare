-- Card ao vivo: tema do app no aparelho (o card do iPhone segue Claro/Escuro/
-- Sistema escolhido no app).
--
-- APLICAR ANTES DO DEPLOY: o Prisma passa a ler Users_Devices.card_tema ao
-- abrir o card e ao registrar o aparelho.
--
-- Users_Devices.card_tema VARCHAR(10) NULL — anulável, sem default: não
-- reescreve linhas. Idempotente.

SET SESSION lock_wait_timeout = 10;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Users_Devices' AND COLUMN_NAME = 'card_tema') = 0,
  'ALTER TABLE `Users_Devices` ADD COLUMN `card_tema` VARCHAR(10) NULL AFTER `card_android`',
  'SELECT ''card_tema: ja existe'' AS passo_1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Verificação: deve retornar ok = 1.
SELECT 'Users_Devices.card_tema' AS item,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Users_Devices'
      AND COLUMN_NAME = 'card_tema' AND IS_NULLABLE = 'YES' AND CHARACTER_MAXIMUM_LENGTH = 10) AS ok;
