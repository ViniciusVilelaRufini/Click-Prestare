-- Recuperação de senha por código de 6 dígitos no app mobile
-- Migração executada em 25/09/2026.

ALTER TABLE `redefinicoes_senha`
  ADD COLUMN `ticket_id` VARCHAR(64) NULL AFTER `id_conta`,
  ADD COLUMN `codigo_hash` VARCHAR(255) NULL AFTER `token_hash`,
  ADD COLUMN `tentativas` INT NOT NULL DEFAULT 0 AFTER `codigo_hash`,
  ADD COLUMN `reset_token_hash` CHAR(64) NULL AFTER `tentativas`,
  ADD COLUMN `verificado_em` DATETIME NULL AFTER `usado_em`,
  MODIFY COLUMN `token_hash` CHAR(64) NULL,
  ADD UNIQUE KEY `un_redefinicao_ticket` (`ticket_id`),
  ADD KEY `idx_redefinicao_reset_token` (`reset_token_hash`);
