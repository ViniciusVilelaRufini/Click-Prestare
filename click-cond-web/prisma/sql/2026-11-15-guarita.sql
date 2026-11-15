-- Módulo Guarita (Nice / Linear-HCS): colunas novas em Tags e as tabelas da
-- integração (fila de operações, eventos brutos, cópias de segurança, portões,
-- alertas e partes de importação).
--
-- APLICAR ANTES DO DEPLOY do código que usa estas colunas. Se o código subir
-- primeiro, o Prisma passa a pedir as colunas novas de Tags em toda leitura de
-- tag e de veículo (a lista de Veículos do console e do app, o cadastro de tag,
-- a leitura de tag na antena) e tudo isso falha ("Unknown column"). Aplicar,
-- rodar 2026-11-15-guarita-verificacao.sql e só então publicar.
--
-- Seguro com o código ANTIGO no ar: só adiciona colunas anuláveis em Tags e
-- tabelas novas. O código antigo não lê nada disso. Nada é apagado nem
-- reescrito: as tags existentes ficam com as colunas novas NULL, que é
-- exatamente "tag comum, sem Guarita".
--
-- O que faz:
--   1. Tags: id_device INT NULL, id_apto INT NULL, guarita_tipo TINYINT NULL,
--      guarita_serial VARCHAR(8) NULL, guarita_contador INT NULL,
--      guarita_estado VARCHAR(24) NULL, guarita_erro VARCHAR(255) NULL,
--      guarita_frame CHAR(78) NULL, guarita_em DATETIME NULL.
--   2. Tags: índice idx_tag_guarita (id_device, guarita_tipo, guarita_serial)
--      e índice fk_tag_guarita_apto (id_apto).
--   3. Tags: FK id_device -> Facial_Devices e id_apto -> Apartamentos, as duas
--      ON DELETE SET NULL (excluir o Guarita ou a unidade não apaga a tag).
--   4. Tabelas Guarita_Operacoes, Guarita_Eventos (único id_device+chave),
--      Guarita_Backups, Guarita_Portoes, Guarita_Alertas e Guarita_Importacoes
--      (único id_operacao+parte), com FKs em cascata para Condominios /
--      Facial_Devices / Guarita_Operacoes, como as vizinhas.
--   Acessos_Facial não muda (o evento do Guarita entra com
--   tipo_dispositivo = 'guarita').
--
-- Idempotente: cada passo confere o information_schema (ou usa IF NOT EXISTS)
-- e vira no-op se já foi aplicado. Rodar numa única sessão (usa @sql).
-- Compatível com MySQL 8.4. Tags é pequena (dados de teste): os ALTER levam
-- segundos. Nenhuma comparação de texto entre tabelas.
--
-- lock_wait_timeout de 10 s: se outra sessão segurar o metadata lock de Tags,
-- o ALTER desiste em vez de enfileirar as leituras de tag atrás dele. Basta
-- rodar de novo depois.

SET SESSION lock_wait_timeout = 10;

-- 1. Tags: colunas ------------------------------------------------------------

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Tags' AND COLUMN_NAME = 'id_device') = 0,
  'ALTER TABLE `Tags` ADD COLUMN `id_device` INT NULL',
  'SELECT ''Tags.id_device: ja existe'' AS passo_1a');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Tags' AND COLUMN_NAME = 'id_apto') = 0,
  'ALTER TABLE `Tags` ADD COLUMN `id_apto` INT NULL',
  'SELECT ''Tags.id_apto: ja existe'' AS passo_1b');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Tags' AND COLUMN_NAME = 'guarita_tipo') = 0,
  'ALTER TABLE `Tags` ADD COLUMN `guarita_tipo` TINYINT NULL',
  'SELECT ''Tags.guarita_tipo: ja existe'' AS passo_1c');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Tags' AND COLUMN_NAME = 'guarita_serial') = 0,
  'ALTER TABLE `Tags` ADD COLUMN `guarita_serial` VARCHAR(8) NULL',
  'SELECT ''Tags.guarita_serial: ja existe'' AS passo_1d');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Tags' AND COLUMN_NAME = 'guarita_contador') = 0,
  'ALTER TABLE `Tags` ADD COLUMN `guarita_contador` INT NULL',
  'SELECT ''Tags.guarita_contador: ja existe'' AS passo_1e');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Tags' AND COLUMN_NAME = 'guarita_estado') = 0,
  'ALTER TABLE `Tags` ADD COLUMN `guarita_estado` VARCHAR(24) NULL',
  'SELECT ''Tags.guarita_estado: ja existe'' AS passo_1f');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Tags' AND COLUMN_NAME = 'guarita_erro') = 0,
  'ALTER TABLE `Tags` ADD COLUMN `guarita_erro` VARCHAR(255) NULL',
  'SELECT ''Tags.guarita_erro: ja existe'' AS passo_1g');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Tags' AND COLUMN_NAME = 'guarita_frame') = 0,
  'ALTER TABLE `Tags` ADD COLUMN `guarita_frame` CHAR(78) NULL',
  'SELECT ''Tags.guarita_frame: ja existe'' AS passo_1h');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Tags' AND COLUMN_NAME = 'guarita_em') = 0,
  'ALTER TABLE `Tags` ADD COLUMN `guarita_em` DATETIME NULL',
  'SELECT ''Tags.guarita_em: ja existe'' AS passo_1i');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. Tags: índices -----------------------------------------------------------

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Tags' AND INDEX_NAME = 'idx_tag_guarita') = 0,
  'ALTER TABLE `Tags` ADD INDEX `idx_tag_guarita` (`id_device`, `guarita_tipo`, `guarita_serial`)',
  'SELECT ''idx_tag_guarita: ja existe'' AS passo_2a');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Tags' AND INDEX_NAME = 'fk_tag_guarita_apto') = 0,
  'ALTER TABLE `Tags` ADD INDEX `fk_tag_guarita_apto` (`id_apto`)',
  'SELECT ''fk_tag_guarita_apto (indice): ja existe'' AS passo_2b');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3. Tags: FKs (SET NULL) ----------------------------------------------------

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'Tags'
      AND CONSTRAINT_NAME = 'fk_tag_guarita_device' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0,
  'ALTER TABLE `Tags` ADD CONSTRAINT `fk_tag_guarita_device` FOREIGN KEY (`id_device`) REFERENCES `Facial_Devices` (`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT ''fk_tag_guarita_device: ja existe'' AS passo_3a');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'Tags'
      AND CONSTRAINT_NAME = 'fk_tag_guarita_apto' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0,
  'ALTER TABLE `Tags` ADD CONSTRAINT `fk_tag_guarita_apto` FOREIGN KEY (`id_apto`) REFERENCES `Apartamentos` (`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT ''fk_tag_guarita_apto: ja existe'' AS passo_3b');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4. Tabelas novas -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS `Guarita_Operacoes` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `id_condominio` INT NOT NULL,
  `id_device` INT NOT NULL,
  `id_tag` INT NULL,
  `id_veiculo` INT NULL,
  `tipo` VARCHAR(24) NOT NULL,
  `frame_hex` CHAR(78) NULL,
  `estado` VARCHAR(16) NOT NULL DEFAULT 'pendente',
  `codigo` INT NULL,
  `erro` VARCHAR(255) NULL,
  `criado_por` VARCHAR(120) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `enviada_em` DATETIME(0) NULL,
  `concluida_em` DATETIME(0) NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_gop_device_estado` (`id_device`, `estado`, `id`),
  INDEX `fk_gop_cond` (`id_condominio`),
  INDEX `idx_gop_tag` (`id_tag`),
  CONSTRAINT `fk_gop_cond` FOREIGN KEY (`id_condominio`) REFERENCES `Condominios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_gop_device` FOREIGN KEY (`id_device`) REFERENCES `Facial_Devices` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `Guarita_Eventos` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `id_condominio` INT NOT NULL,
  `id_device` INT NOT NULL,
  `chave` CHAR(64) NOT NULL,
  `frame_hex` CHAR(32) NOT NULL,
  `ocorrido_em` DATETIME(0) NULL,
  `origem` VARCHAR(12) NOT NULL,
  `id_acesso` INT NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `un_gev_device_chave` (`id_device`, `chave`),
  INDEX `idx_gev_cond_criado` (`id_condominio`, `created_at`),
  CONSTRAINT `fk_gev_cond` FOREIGN KEY (`id_condominio`) REFERENCES `Condominios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_gev_device` FOREIGN KEY (`id_device`) REFERENCES `Facial_Devices` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `Guarita_Backups` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `id_condominio` INT NOT NULL,
  `id_device` INT NOT NULL,
  `motivo` VARCHAR(40) NOT NULL,
  `total` INT NOT NULL,
  `dados` LONGTEXT NOT NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_gbk_device_motivo` (`id_device`, `motivo`, `id`),
  INDEX `fk_gbk_cond` (`id_condominio`),
  CONSTRAINT `fk_gbk_cond` FOREIGN KEY (`id_condominio`) REFERENCES `Condominios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_gbk_device` FOREIGN KEY (`id_device`) REFERENCES `Facial_Devices` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `Guarita_Portoes` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `id_condominio` INT NOT NULL,
  `id_device` INT NOT NULL,
  `nome` VARCHAR(100) NOT NULL,
  `tipo_receptor` TINYINT NOT NULL,
  `num_receptor` TINYINT NOT NULL,
  `botao` TINYINT NULL,
  `rele` TINYINT NULL,
  `sentido` VARCHAR(10) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `fk_gpt_device` (`id_device`),
  INDEX `fk_gpt_cond` (`id_condominio`),
  CONSTRAINT `fk_gpt_cond` FOREIGN KEY (`id_condominio`) REFERENCES `Condominios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_gpt_device` FOREIGN KEY (`id_device`) REFERENCES `Facial_Devices` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `Guarita_Alertas` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `id_condominio` INT NOT NULL,
  `id_device` INT NOT NULL,
  `tipo` VARCHAR(30) NOT NULL,
  `descricao` VARCHAR(255) NOT NULL,
  `dados` TEXT NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `visto_em` DATETIME(0) NULL,
  `visto_por` VARCHAR(120) NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_gal_cond_visto` (`id_condominio`, `visto_em`, `id`),
  INDEX `fk_gal_device` (`id_device`),
  CONSTRAINT `fk_gal_cond` FOREIGN KEY (`id_condominio`) REFERENCES `Condominios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_gal_device` FOREIGN KEY (`id_device`) REFERENCES `Facial_Devices` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `Guarita_Importacoes` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `id_operacao` INT NOT NULL,
  `parte` INT NOT NULL,
  `frames` LONGTEXT NOT NULL,
  `fim` TINYINT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `un_gim_operacao_parte` (`id_operacao`, `parte`),
  CONSTRAINT `fk_gim_operacao` FOREIGN KEY (`id_operacao`) REFERENCES `Guarita_Operacoes` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
