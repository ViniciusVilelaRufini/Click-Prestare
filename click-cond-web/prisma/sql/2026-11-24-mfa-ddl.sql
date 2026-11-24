-- DDL versionado de mfa_challenges e user_trusted_devices (D9, varredura 24/11).
--
-- Por quê: as duas tabelas do MFA do síndico (auth/mfa/mfa.service.ts) foram
-- criadas por `prisma db push` e não tinham SQL no repositório. Um banco novo
-- (restore parcial, ambiente de teste, outro cliente) montado só pelos SQL de
-- prisma/sql ficava sem elas e o login do síndico com MFA quebrava.
--
-- Idêntico ao schema.prisma (Mfa_Challenges e User_Trusted_Devices), na forma
-- que `prisma migrate diff --from-empty --to-schema-datamodel` gera, com a FK
-- dentro do CREATE TABLE.
--
-- No RDS de hoje as duas tabelas JÁ EXISTEM: este script não muda nada lá
-- (CREATE TABLE IF NOT EXISTS não confere nem altera uma tabela existente). A
-- verificação confere se a tabela existente bate com o schema; se algum item
-- der 0, a diferença é do banco e deve ser tratada à parte (não recriar a
-- tabela: mfa_challenges é temporária, mas user_trusted_devices guarda os
-- aparelhos confiáveis de 30 dias).
--
-- Idempotente. Seguro com o código antigo no ar. MySQL 8.4.

SET SESSION lock_wait_timeout = 10;

CREATE TABLE IF NOT EXISTS `mfa_challenges` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `id_user` INTEGER NOT NULL,
    `token` CHAR(36) NOT NULL,
    `code_hash` VARCHAR(255) NOT NULL,
    `tentativas` INTEGER NOT NULL DEFAULT 0,
    `expires_at` DATETIME(0) NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uni_mfa_challenges_token`(`token`),
    INDEX `idx_mfa_challenges_token`(`token`),
    INDEX `idx_mfa_challenges_user_exp`(`id_user`, `expires_at`),
    PRIMARY KEY (`id`),
    CONSTRAINT `fk_mfa_challenges_user` FOREIGN KEY (`id_user`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_trusted_devices` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `id_user` INTEGER NOT NULL,
    `device_hash` CHAR(64) NOT NULL,
    `user_agent` VARCHAR(255) NULL,
    `ip_address` VARCHAR(45) NULL,
    `expires_at` DATETIME(0) NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uni_user_trusted_devices_hash`(`device_hash`),
    INDEX `idx_user_trusted_devices_user_exp`(`id_user`, `expires_at`),
    PRIMARY KEY (`id`),
    CONSTRAINT `fk_user_trusted_devices_user` FOREIGN KEY (`id_user`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
