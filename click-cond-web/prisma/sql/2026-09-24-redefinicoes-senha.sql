-- Recuperação segura de senha via link com prazo de expiração (design em
-- docs/superpowers/plans/2026-09-24-seguranca-f2-f4.md).
--
-- Idempotente: pode rodar duas vezes sem erro.

CREATE TABLE IF NOT EXISTS `redefinicoes_senha` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `papel` VARCHAR(20) NOT NULL,
  `id_conta` INT NOT NULL,
  `token_hash` CHAR(64) NOT NULL,
  `expira_em` DATETIME NOT NULL,
  `usado_em` DATETIME NULL,
  `criado_em` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ip` VARCHAR(45) NULL,

  PRIMARY KEY (`id`),
  UNIQUE KEY `un_redefinicao_token` (`token_hash`),
  KEY `idx_redefinicao_conta_papel` (`id_conta`, `papel`),
  KEY `idx_redefinicao_expira` (`expira_em`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
