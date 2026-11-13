-- Card ao vivo da portaria remota (Live Activity no iPhone, notificação fixa
-- no Android). Spec: docs/superpowers/specs/2026-11-13-card-ao-vivo-portaria-remota-design.md
--
-- APLICAR ANTES DO DEPLOY do código do card. Se o código subir primeiro, o
-- Prisma passa a pedir Users_Devices.card_token_inicio em todo registro de
-- aparelho (update-fcm-token falha) e o pedido de autorização falha ao gravar
-- o card. Aplicar, rodar 2026-11-13-card-ao-vivo-verificacao.sql e só então
-- publicar.
--
-- O que faz:
--   1. Users_Devices.card_token_inicio VARCHAR(200) NULL — token de
--      push-to-start do iPhone. Anulável, sem default: não reescreve linhas.
--   2. Tabela Cards_Ao_Vivo (um card por pedido por aparelho), FK para Users
--      com ON DELETE CASCADE (conta apagada leva os cards junto). Sem FK para
--      o pedido: linha efêmera, não pode impedir apagar visitante.
--
-- Idempotente: cada passo confere o information_schema.

SET SESSION lock_wait_timeout = 10;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Users_Devices' AND COLUMN_NAME = 'card_token_inicio') = 0,
  'ALTER TABLE `Users_Devices` ADD COLUMN `card_token_inicio` VARCHAR(200) NULL AFTER `plataforma`',
  'SELECT ''card_token_inicio: ja existe'' AS passo_1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `Cards_Ao_Vivo` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `origem` VARCHAR(10) NOT NULL,
  `id_pedido` INT NOT NULL,
  `id_user` INT NOT NULL,
  `plataforma` VARCHAR(10) NOT NULL,
  `fcm_token` VARCHAR(500) NOT NULL,
  `token_inicio` VARCHAR(200) NULL,
  `token_atualizacao` VARCHAR(200) NULL,
  `fase` VARCHAR(20) NOT NULL,
  `fase_em` DATETIME(0) NOT NULL,
  `confirmado_em` DATETIME(0) NULL,
  `reserva_enviada_em` DATETIME(0) NULL,
  `encerrado_em` DATETIME(0) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_cav_pedido` (`origem`, `id_pedido`),
  INDEX `idx_cav_aberto_fase` (`encerrado_em`, `fase`),
  INDEX `idx_cav_user` (`id_user`),
  CONSTRAINT `fk_cards_ao_vivo_user` FOREIGN KEY (`id_user`) REFERENCES `Users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
