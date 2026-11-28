-- Portaria autônoma, Entrega 1 (central humana): agenda local/central por
-- condomínio, operadores da central, pedidos de autorização por chamada e as
-- colunas novas em Condominios e Interfone_Chamadas.
-- Spec: docs/superpowers/specs/2026-11-28-portaria-autonoma-design.md
--
-- APLICAR ANTES DO DEPLOY do código. Se o código subir primeiro, o Prisma passa
-- a pedir as colunas novas em todo SELECT de Condominios e Interfone_Chamadas e
-- a API quebra em quase toda rota. Aplicar, rodar
-- 2026-11-28-portaria-autonoma-verificacao.sql (todas as linhas OK) e só então
-- publicar.
--
-- O que faz (só ADD — nada é apagado nem reescrito, sem migração de dados):
--   1. Condominios: central_contratada, ia_portao_ativa (0 = desligado),
--      instrucao_entregas (TEXT), interfone_numero_portaria (VARCHAR(8), '0').
--   2. Interfone_Chamadas: id_operador_central, ia_resumo, ia_transcricao,
--      destino (VARCHAR(8) NULL: 'local' | 'central', para onde a chamada foi
--      encaminhada na portaria; null nas chamadas antigas e nas que não
--      passaram pela portaria).
--      (tipo 'facial_portaria', atendida_por_tipo 'central' e resultado
--      'atendida_central' cabem nas colunas VarChar atuais.)
--   3. Portaria_Agenda: janelas semanais (dia, HH:MM-HH:MM) e destino
--      local|central. FK Condominios ON DELETE CASCADE.
--   4. Central_Operadores: operadores da central (login próprio, e-mail único).
--   5. Interfone_Pedidos: pedido de autorização por chamada. FKs para
--      Interfone_Chamadas, Condominios e Apartamentos com ON DELETE CASCADE.
--
-- Idempotente: cada passo confere o information_schema e vira no-op se já foi
-- aplicado. Rodar numa única sessão (usa @sql). MySQL 8.4.

SET SESSION lock_wait_timeout = 10;

-- 1. Condominios ---------------------------------------------------------------

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Condominios' AND COLUMN_NAME = 'central_contratada') = 0,
  'ALTER TABLE `Condominios` ADD COLUMN `central_contratada` TINYINT NOT NULL DEFAULT 0',
  'SELECT ''Condominios.central_contratada: ja existe'' AS passo_1a');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Condominios' AND COLUMN_NAME = 'ia_portao_ativa') = 0,
  'ALTER TABLE `Condominios` ADD COLUMN `ia_portao_ativa` TINYINT NOT NULL DEFAULT 0',
  'SELECT ''Condominios.ia_portao_ativa: ja existe'' AS passo_1b');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Condominios' AND COLUMN_NAME = 'instrucao_entregas') = 0,
  'ALTER TABLE `Condominios` ADD COLUMN `instrucao_entregas` TEXT NULL',
  'SELECT ''Condominios.instrucao_entregas: ja existe'' AS passo_1c');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Condominios' AND COLUMN_NAME = 'interfone_numero_portaria') = 0,
  'ALTER TABLE `Condominios` ADD COLUMN `interfone_numero_portaria` VARCHAR(8) NOT NULL DEFAULT ''0''',
  'SELECT ''Condominios.interfone_numero_portaria: ja existe'' AS passo_1d');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. Interfone_Chamadas ---------------------------------------------------------

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Chamadas' AND COLUMN_NAME = 'id_operador_central') = 0,
  'ALTER TABLE `Interfone_Chamadas` ADD COLUMN `id_operador_central` INT NULL',
  'SELECT ''Interfone_Chamadas.id_operador_central: ja existe'' AS passo_2a');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Chamadas' AND COLUMN_NAME = 'ia_resumo') = 0,
  'ALTER TABLE `Interfone_Chamadas` ADD COLUMN `ia_resumo` TEXT NULL',
  'SELECT ''Interfone_Chamadas.ia_resumo: ja existe'' AS passo_2b');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Chamadas' AND COLUMN_NAME = 'ia_transcricao') = 0,
  'ALTER TABLE `Interfone_Chamadas` ADD COLUMN `ia_transcricao` MEDIUMTEXT NULL',
  'SELECT ''Interfone_Chamadas.ia_transcricao: ja existe'' AS passo_2c');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Chamadas' AND COLUMN_NAME = 'destino') = 0,
  'ALTER TABLE `Interfone_Chamadas` ADD COLUMN `destino` VARCHAR(8) NULL',
  'SELECT ''Interfone_Chamadas.destino: ja existe'' AS passo_2d');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3. Portaria_Agenda ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `Portaria_Agenda` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `id_condominio` INT NOT NULL,
  `dia_semana` TINYINT NOT NULL,
  `inicio` CHAR(5) NOT NULL,
  `fim` CHAR(5) NOT NULL,
  `destino` VARCHAR(8) NOT NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_pag_cond_dia` (`id_condominio`, `dia_semana`),
  CONSTRAINT `fk_pag_cond` FOREIGN KEY (`id_condominio`) REFERENCES `Condominios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Central_Operadores ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS `Central_Operadores` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `nome` VARCHAR(120) NOT NULL,
  `email` VARCHAR(190) NOT NULL,
  `senha_hash` VARCHAR(100) NOT NULL,
  `trocar_senha` TINYINT NOT NULL DEFAULT 1,
  `ativo` TINYINT NOT NULL DEFAULT 1,
  `cred` VARCHAR(32) NOT NULL DEFAULT '',
  `ultimo_acesso` DATETIME(0) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_cop_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Interfone_Pedidos ----------------------------------------------------------

CREATE TABLE IF NOT EXISTS `Interfone_Pedidos` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `id_chamada` INT NOT NULL,
  `id_condominio` INT NOT NULL,
  `id_apartamento` INT NOT NULL,
  `nome_falado` VARCHAR(120) NOT NULL,
  `motivo` VARCHAR(255) NULL,
  `tipo` VARCHAR(10) NOT NULL,
  `origem` VARCHAR(10) NOT NULL,
  `foto` VARCHAR(255) NULL,
  `estado` VARCHAR(10) NOT NULL DEFAULT 'pendente',
  `mensagem` VARCHAR(120) NULL,
  `respondido_por_id` INT NULL,
  `respondido_por_nome` VARCHAR(120) NULL,
  `respondido_em` DATETIME(0) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_ipd_chamada` (`id_chamada`),
  INDEX `idx_ipd_apto_created` (`id_apartamento`, `created_at`),
  INDEX `idx_ipd_cond` (`id_condominio`),
  CONSTRAINT `fk_ipd_chamada` FOREIGN KEY (`id_chamada`) REFERENCES `Interfone_Chamadas` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_ipd_cond` FOREIGN KEY (`id_condominio`) REFERENCES `Condominios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_ipd_apto` FOREIGN KEY (`id_apartamento`) REFERENCES `Apartamentos` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
