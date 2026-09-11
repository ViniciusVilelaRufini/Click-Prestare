-- Consentimento LGPD (design em
-- docs/superpowers/specs/2026-09-11-aceite-de-privacidade-lgpd-design.md).
--
-- O Railway NÃO roda migração automática: aplicar à mão e verificar ANTES do
-- deploy da API, senão o Prisma quebra o módulo no boot.
--
-- Idempotente: pode rodar duas vezes.

CREATE TABLE IF NOT EXISTS `Consentimentos` (
  `id`            INT NOT NULL AUTO_INCREMENT,
  `id_user`       INT NOT NULL,

  -- 'privacidade' (obrigatório para usar o app) | 'biometria' (opcional;
  -- dado sensível pelo Art. 11 da LGPD, exige consentimento destacado).
  `tipo`          VARCHAR(20) NOT NULL,

  -- Versão do texto vigente no momento do aceite. Sem ela, "aceitei" é uma
  -- afirmação sobre um texto que ninguém sabe mais qual era.
  `versao`        VARCHAR(20) NOT NULL,

  -- 1 aceitou, 0 recusou. A recusa também é fato a registrar.
  `aceito`        TINYINT NOT NULL,

  `registrado_em` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  KEY `idx_consent_user_tipo` (`id_user`, `tipo`, `registrado_em`),

  CONSTRAINT `fk_consent_user` FOREIGN KEY (`id_user`)
    REFERENCES `Users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- APPEND-ONLY: nunca fazer UPDATE nesta tabela. Revogação é INSERT novo com
-- `aceito = 0`. O histórico é o que dá sustentação jurídica ao tratamento.
