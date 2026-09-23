-- Pessoas + Visitas: identidade separada da autorizacao.
-- Aplicar com a base vazia (Visitantes tem 0 linhas apos o wipe de 2026-09-20).

CREATE TABLE `pessoas` (
  `id`                INT NOT NULL AUTO_INCREMENT,
  `id_condominio`     INT NOT NULL,
  `nome`              VARCHAR(255) NOT NULL,
  `doc_identificacao` VARCHAR(50) NULL,
  `telefone`          VARCHAR(50) NULL,
  `foto_pessoa`       LONGTEXT NULL,
  `foto_documento`    LONGTEXT NULL,
  `tipo_pessoa`       VARCHAR(20) NOT NULL DEFAULT 'visitante',
  `face_id`           VARCHAR(100) NULL,
  `face_enrolled_at`  DATETIME NULL,
  `face_sync_status`  VARCHAR(20) NULL,
  `face_sync_error`   VARCHAR(500) NULL,
  `bloqueado`         TINYINT NOT NULL DEFAULT 0,
  `created_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  -- Garante "uma linha por humano por condominio". Sem isto, dois POST
  -- simultaneos do mesmo CPF criam duas Pessoas e o terminal ganha dois rostos.
  UNIQUE KEY `uq_pes_cond_doc` (`id_condominio`, `doc_identificacao`),
  KEY `idx_pes_cond` (`id_condominio`),
  KEY `idx_pes_cond_nome` (`id_condominio`, `nome`),
  CONSTRAINT `fk_pes_cond` FOREIGN KEY (`id_condominio`) REFERENCES `Condominios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `visitas` (
  `id`                  INT NOT NULL AUTO_INCREMENT,
  `id_pessoa`           INT NOT NULL,
  `id_condominio`       INT NOT NULL,
  `id_apartamento`      INT NOT NULL,
  `user`                INT NULL,
  `is_visitante`        TINYINT NOT NULL DEFAULT 1,
  `is_prestador`        TINYINT NOT NULL DEFAULT 0,
  `data_hora_inicio`    DATETIME NULL,
  `data_hora_termino`   DATETIME NULL,
  `data_entrada`        DATETIME NULL,
  `data_saida`          DATETIME NULL,
  `codigo_acesso`       VARCHAR(50) NULL,
  `liberado`            TINYINT NOT NULL DEFAULT 1,
  `bloqueado`           TINYINT NOT NULL DEFAULT 0,
  `avisar`              TINYINT NOT NULL DEFAULT 1,
  `tag_rfid`            VARCHAR(50) NULL,
  `dias_semana`         VARCHAR(100) NULL,
  `categorias`          VARCHAR(500) NULL,
  `auth_status`         VARCHAR(20) NULL,
  `auth_solicitado_em`  DATETIME NULL,
  `auth_respondido_em`  DATETIME NULL,
  `auth_respondido_por` INT NULL,
  `created_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_visita_pessoa` (`id_pessoa`),
  KEY `idx_visita_cond_entrada` (`id_condominio`, `data_entrada`),
  KEY `idx_visita_apto` (`id_apartamento`),
  KEY `idx_visita_cond_pin` (`id_condominio`, `codigo_acesso`),
  KEY `fk_visita_user` (`user`),
  CONSTRAINT `fk_visita_pessoa` FOREIGN KEY (`id_pessoa`) REFERENCES `pessoas` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_visita_cond` FOREIGN KEY (`id_condominio`) REFERENCES `Condominios` (`id`) ON DELETE CASCADE,
  -- RESTRICT e nao CASCADE: historico de visita e registro de acesso fisico,
  -- nao pode sumir junto com o apartamento. Coerente com as FKs de Acessos_Facial.
  CONSTRAINT `fk_visita_apto` FOREIGN KEY (`id_apartamento`) REFERENCES `Apartamentos` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_visita_user` FOREIGN KEY (`user`) REFERENCES `Users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Vagas passa a poder referenciar uma visita. O codigo ja le esta coluna
-- (visitas.service.ts, visitantes.service.ts); sem ela, qualquer SELECT em
-- Vagas falha com Unknown column assim que o schema Prisma a declara.
ALTER TABLE `Vagas`
  ADD COLUMN `id_visita` INT NULL AFTER `id_visitante`,
  ADD KEY `fk_vaga_visita` (`id_visita`),
  ADD CONSTRAINT `fk_vaga_visita` FOREIGN KEY (`id_visita`) REFERENCES `visitas` (`id`) ON DELETE SET NULL;
