-- Convite de visita por link (design em
-- docs/superpowers/specs/2026-09-11-convite-de-visita-por-link-design.md).
--
-- O Railway NÃO roda migração automática: este arquivo é aplicado à mão e
-- verificado ANTES do deploy da API. Subir o código sem a tabela quebra o
-- módulo no boot do Prisma.
--
-- Idempotente: pode rodar duas vezes sem erro.

CREATE TABLE IF NOT EXISTS `Convites_Visita` (
  `id`             INT NOT NULL AUTO_INCREMENT,

  -- SHA-256 do token, nunca o token. Se o banco vazar, os links não são
  -- utilizáveis.
  `token_hash`     CHAR(64) NOT NULL,

  `id_condominio`  INT NOT NULL,
  `id_apartamento` INT NOT NULL,
  `id_usuario`     INT NOT NULL,
  `is_prestador`   TINYINT NOT NULL DEFAULT 0,

  -- aguardando → preenchido → confirmado | recusado.
  -- "Expirado" é derivado de `expira_em`, não gravado: a validade não pode
  -- depender de um job ter rodado.
  `status`         VARCHAR(20) NOT NULL DEFAULT 'aguardando',
  `expira_em`      DATETIME NOT NULL,
  `created_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Preenchidos pelo visitante. `cpf` só com dígitos.
  `nome`           VARCHAR(255) NULL,
  `cpf`            VARCHAR(11) NULL,
  `foto_url`       LONGTEXT NULL,

  `aceite_em`      DATETIME NULL,
  `preenchido_em`  DATETIME NULL,
  `respondido_em`  DATETIME NULL,
  `id_visitante`   INT NULL,

  PRIMARY KEY (`id`),
  UNIQUE KEY `un_convite_token` (`token_hash`),
  KEY `idx_convite_cond_status` (`id_condominio`, `status`),
  KEY `idx_convite_user_status` (`id_usuario`, `status`),

  CONSTRAINT `fk_convite_cond` FOREIGN KEY (`id_condominio`)
    REFERENCES `Condominios` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_convite_apto` FOREIGN KEY (`id_apartamento`)
    REFERENCES `Apartamentos` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_convite_user` FOREIGN KEY (`id_usuario`)
    REFERENCES `Users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
