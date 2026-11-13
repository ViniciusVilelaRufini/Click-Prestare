-- Card ao vivo do delivery: versão do card que o app sabe desenhar.
-- Spec: docs/superpowers/specs/2026-11-13-card-ao-vivo-delivery-design.md
--
-- APLICAR ANTES DO DEPLOY: o Prisma passa a ler Users_Devices.card_versao ao
-- abrir o card e ao registrar o aparelho.
--
-- Users_Devices.card_versao INT NOT NULL DEFAULT 1 — 1 = app que só desenha o
-- card da portaria (1.2.42–1.2.45); o app novo grava 2. Tabela pequena (um
-- registro por aparelho). Idempotente.

SET SESSION lock_wait_timeout = 10;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Users_Devices' AND COLUMN_NAME = 'card_versao') = 0,
  'ALTER TABLE `Users_Devices` ADD COLUMN `card_versao` INT NOT NULL DEFAULT 1 AFTER `card_tema`',
  'SELECT ''card_versao: ja existe'' AS passo_1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Verificação: deve retornar ok = 1.
SELECT 'Users_Devices.card_versao' AS item,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Users_Devices'
      AND COLUMN_NAME = 'card_versao' AND IS_NULLABLE = 'NO' AND COLUMN_DEFAULT = '1') AS ok;
