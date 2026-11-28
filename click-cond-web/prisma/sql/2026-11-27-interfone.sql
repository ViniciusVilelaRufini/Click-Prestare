-- Interfone pelo app: o morador atende no celular o visitante que chama pelo
-- facial, com transferência para o console da portaria e ligações portaria <->
-- unidade. Spec: docs/superpowers/specs/2026-11-27-interfone-pelo-app-design.md
-- Plano: docs/superpowers/plans/2026-11-27-interfone-pelo-app.md (Task A1)
--
-- APLICAR ANTES DO DEPLOY do código do interfone. Se o código subir primeiro, o
-- Prisma passa a pedir as colunas novas em todo SELECT dessas tabelas
-- (Condominios, Apartamentos, Facial_Devices, Users, Users_Devices) e a API
-- quebra em quase toda rota. Aplicar, rodar 2026-11-27-interfone-verificacao.sql
-- (todas as linhas OK) e só então publicar.
--
-- O que faz (só ADD — nada é apagado nem reescrito):
--   1. Condominios: interfone_contratado (CRM liga), interfone_ativo (síndico
--      liga), interfone_toque_apto_s (30), interfone_transferir (1),
--      interfone_toque_portaria_s (45). Defaults: módulo desligado.
--   2. Apartamentos.interfone_ramal VARCHAR(10) NULL + chave única
--      un_apto_ramal (id_condominio, interfone_ramal). NULL não colide (MySQL):
--      unidades sem ramal continuam livres.
--   3. Facial_Devices: interfone_habilitado, interfone_senha (conta SIP),
--      interfone_blocos (JSON; NULL = todos), interfone_dtmf (abrir pelo
--      facial), interfone_registrado / interfone_registrado_em.
--   4. Users_Devices: voip_token (PushKit do iPhone), interfone_versao (0 = app
--      sem interfone, recebe push comum).
--   5. Users.interfone_receber (1): morador pode desligar o toque.
--   6. Tabela Interfone_Monitores (monitores IP de unidade, conta SIP própria),
--      FKs para Condominios e Apartamentos com ON DELETE CASCADE.
--   7. Tabela Interfone_Chamadas (registro de cada chamada). FK para
--      Condominios com CASCADE; facial, apartamento e usuário de origem com
--      SET NULL (apagar um facial/unidade/conta não apaga o histórico).
--
-- Idempotente: cada passo confere o information_schema e vira no-op se já foi
-- aplicado. Rodar numa única sessão (usa @sql). MySQL 8.4.

SET SESSION lock_wait_timeout = 10;

-- 1. Condominios ---------------------------------------------------------------

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Condominios' AND COLUMN_NAME = 'interfone_contratado') = 0,
  'ALTER TABLE `Condominios` ADD COLUMN `interfone_contratado` TINYINT NOT NULL DEFAULT 0',
  'SELECT ''Condominios.interfone_contratado: ja existe'' AS passo_1a');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Condominios' AND COLUMN_NAME = 'interfone_ativo') = 0,
  'ALTER TABLE `Condominios` ADD COLUMN `interfone_ativo` TINYINT NOT NULL DEFAULT 0',
  'SELECT ''Condominios.interfone_ativo: ja existe'' AS passo_1b');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Condominios' AND COLUMN_NAME = 'interfone_toque_apto_s') = 0,
  'ALTER TABLE `Condominios` ADD COLUMN `interfone_toque_apto_s` INT NOT NULL DEFAULT 30',
  'SELECT ''Condominios.interfone_toque_apto_s: ja existe'' AS passo_1c');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Condominios' AND COLUMN_NAME = 'interfone_transferir') = 0,
  'ALTER TABLE `Condominios` ADD COLUMN `interfone_transferir` TINYINT NOT NULL DEFAULT 1',
  'SELECT ''Condominios.interfone_transferir: ja existe'' AS passo_1d');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Condominios' AND COLUMN_NAME = 'interfone_toque_portaria_s') = 0,
  'ALTER TABLE `Condominios` ADD COLUMN `interfone_toque_portaria_s` INT NOT NULL DEFAULT 45',
  'SELECT ''Condominios.interfone_toque_portaria_s: ja existe'' AS passo_1e');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. Apartamentos ---------------------------------------------------------------

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Apartamentos' AND COLUMN_NAME = 'interfone_ramal') = 0,
  'ALTER TABLE `Apartamentos` ADD COLUMN `interfone_ramal` VARCHAR(10) NULL',
  'SELECT ''Apartamentos.interfone_ramal: ja existe'' AS passo_2a');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Apartamentos' AND INDEX_NAME = 'un_apto_ramal') = 0,
  'ALTER TABLE `Apartamentos` ADD UNIQUE KEY `un_apto_ramal` (`id_condominio`, `interfone_ramal`)',
  'SELECT ''un_apto_ramal: ja existe'' AS passo_2b');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3. Facial_Devices -------------------------------------------------------------

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Facial_Devices' AND COLUMN_NAME = 'interfone_habilitado') = 0,
  'ALTER TABLE `Facial_Devices` ADD COLUMN `interfone_habilitado` TINYINT NOT NULL DEFAULT 0',
  'SELECT ''Facial_Devices.interfone_habilitado: ja existe'' AS passo_3a');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Facial_Devices' AND COLUMN_NAME = 'interfone_senha') = 0,
  'ALTER TABLE `Facial_Devices` ADD COLUMN `interfone_senha` VARCHAR(64) NULL',
  'SELECT ''Facial_Devices.interfone_senha: ja existe'' AS passo_3b');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Facial_Devices' AND COLUMN_NAME = 'interfone_blocos') = 0,
  'ALTER TABLE `Facial_Devices` ADD COLUMN `interfone_blocos` TEXT NULL',
  'SELECT ''Facial_Devices.interfone_blocos: ja existe'' AS passo_3c');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Facial_Devices' AND COLUMN_NAME = 'interfone_dtmf') = 0,
  'ALTER TABLE `Facial_Devices` ADD COLUMN `interfone_dtmf` VARCHAR(20) NULL',
  'SELECT ''Facial_Devices.interfone_dtmf: ja existe'' AS passo_3d');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Facial_Devices' AND COLUMN_NAME = 'interfone_registrado') = 0,
  'ALTER TABLE `Facial_Devices` ADD COLUMN `interfone_registrado` TINYINT NOT NULL DEFAULT 0',
  'SELECT ''Facial_Devices.interfone_registrado: ja existe'' AS passo_3e');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Facial_Devices' AND COLUMN_NAME = 'interfone_registrado_em') = 0,
  'ALTER TABLE `Facial_Devices` ADD COLUMN `interfone_registrado_em` DATETIME(0) NULL',
  'SELECT ''Facial_Devices.interfone_registrado_em: ja existe'' AS passo_3f');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4. Users_Devices --------------------------------------------------------------

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Users_Devices' AND COLUMN_NAME = 'voip_token') = 0,
  'ALTER TABLE `Users_Devices` ADD COLUMN `voip_token` VARCHAR(200) NULL',
  'SELECT ''Users_Devices.voip_token: ja existe'' AS passo_4a');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Users_Devices' AND COLUMN_NAME = 'interfone_versao') = 0,
  'ALTER TABLE `Users_Devices` ADD COLUMN `interfone_versao` INT NOT NULL DEFAULT 0',
  'SELECT ''Users_Devices.interfone_versao: ja existe'' AS passo_4b');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 5. Users ----------------------------------------------------------------------

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Users' AND COLUMN_NAME = 'interfone_receber') = 0,
  'ALTER TABLE `Users` ADD COLUMN `interfone_receber` TINYINT NOT NULL DEFAULT 1',
  'SELECT ''Users.interfone_receber: ja existe'' AS passo_5');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 6. Interfone_Monitores --------------------------------------------------------

CREATE TABLE IF NOT EXISTS `Interfone_Monitores` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `id_condominio` INT NOT NULL,
  `id_apartamento` INT NOT NULL,
  `nome` VARCHAR(80) NOT NULL,
  `senha` VARCHAR(64) NOT NULL,
  `ativo` TINYINT NOT NULL DEFAULT 1,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_ifm_cond` (`id_condominio`),
  INDEX `idx_ifm_apto` (`id_apartamento`),
  CONSTRAINT `fk_ifm_cond` FOREIGN KEY (`id_condominio`) REFERENCES `Condominios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_ifm_apto` FOREIGN KEY (`id_apartamento`) REFERENCES `Apartamentos` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. Interfone_Chamadas ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS `Interfone_Chamadas` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `id_condominio` INT NOT NULL,
  `tipo` VARCHAR(20) NOT NULL,
  `estado` VARCHAR(12) NOT NULL,
  `resultado` VARCHAR(20) NULL,
  `id_facial` INT NULL,
  `id_apartamento` INT NULL,
  `numero_discado` VARCHAR(10) NULL,
  `id_user_origem` INT NULL,
  `id_porteiro_origem` INT NULL,
  `motivo_portaria` VARCHAR(12) NULL,
  `atendida_em` DATETIME(0) NULL,
  `atendida_por_tipo` VARCHAR(10) NULL,
  `atendida_por_id` INT NULL,
  `atendida_por_nome` VARCHAR(120) NULL,
  `encerrada_em` DATETIME(0) NULL,
  `duracao_s` INT NULL,
  `foto` VARCHAR(500) NULL,
  `porta_aberta_em` DATETIME(0) NULL,
  `porta_aberta_por_nome` VARCHAR(120) NULL,
  `porta_aberta_como` VARCHAR(10) NULL,
  `recusas` TEXT NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_ifc_cond_created` (`id_condominio`, `created_at`),
  INDEX `idx_ifc_apto_created` (`id_apartamento`, `created_at`),
  INDEX `idx_ifc_facial_created` (`id_facial`, `created_at`),
  INDEX `idx_ifc_user_origem` (`id_user_origem`),
  CONSTRAINT `fk_ifc_cond` FOREIGN KEY (`id_condominio`) REFERENCES `Condominios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_ifc_facial` FOREIGN KEY (`id_facial`) REFERENCES `Facial_Devices` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_ifc_apto` FOREIGN KEY (`id_apartamento`) REFERENCES `Apartamentos` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_ifc_user_origem` FOREIGN KEY (`id_user_origem`) REFERENCES `Users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
