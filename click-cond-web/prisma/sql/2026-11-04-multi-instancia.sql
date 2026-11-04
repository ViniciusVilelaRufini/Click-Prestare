-- API em 2 instâncias (EB LoadBalanced): estado que vivia em memória do
-- processo passa para o banco. Aplicar ANTES do deploy que traz o código
-- (o código cai para memória se a tabela estado_compartilhado não existir,
-- mas aí NÃO é seguro subir a segunda instância).
--
-- Idempotente: pode rodar duas vezes sem erro. Só cria tabelas novas.

CREATE TABLE IF NOT EXISTS `estado_compartilhado` (
  `chave` VARCHAR(191) NOT NULL,
  `valor` LONGTEXT NOT NULL,
  `expira_em` DATETIME(3) NOT NULL,
  `consumido_em` DATETIME(3) NULL,
  `criado_em` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`chave`),
  KEY `idx_estado_compartilhado_expira` (`expira_em`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `agente_comandos` (
  `id` VARCHAR(32) NOT NULL,
  `id_device` INT NOT NULL,
  `comando` LONGTEXT NOT NULL,
  `status` VARCHAR(16) NOT NULL,
  `resultado` LONGTEXT NULL,
  `criado_em` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expira_em` DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`),
  KEY `idx_agente_comandos_device_status` (`id_device`, `status`),
  KEY `idx_agente_comandos_expira` (`expira_em`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `agente_dispositivos_estado` (
  `id_device` INT NOT NULL,
  `ultimo_poll_em` DATETIME(3) NULL,
  `aparelho_online` TINYINT NULL,
  `aparelho_status_em` DATETIME(3) NULL,
  `offline_desde` DATETIME(3) NULL,
  `ticket_aberto` TINYINT NOT NULL DEFAULT 0,

  PRIMARY KEY (`id_device`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
