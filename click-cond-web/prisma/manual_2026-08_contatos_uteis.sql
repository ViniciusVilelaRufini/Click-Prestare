-- Contatos Úteis — agenda de mão de obra do condomínio (eletricista, encanador,
-- chaveiro...) que o síndico cadastra e o morador consulta, na mesma tela de
-- Documentos do app.
--
-- Migração MANUAL (Railway = MySQL 8; não roda `prisma db push`/`migrate`).
-- Rodar UMA vez no banco de produção ANTES de subir o deploy que inclui o
-- módulo `contatos` — sem a tabela, GET /contatos/get-all responde 500.
--
-- Usa CREATE TABLE IF NOT EXISTS: reexecutar é seguro (no-op).

CREATE TABLE IF NOT EXISTS Contatos_Uteis (
  id            INT           NOT NULL AUTO_INCREMENT,
  id_condominio INT           NOT NULL,
  nome          VARCHAR(255)  NOT NULL,
  categoria     VARCHAR(100)  NOT NULL,   -- 'Eletricista', 'Encanador', ... (texto livre)
  telefone      VARCHAR(50)   NOT NULL,
  observacao    TEXT          NULL,
  ativo         TINYINT       NOT NULL DEFAULT 1,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY fk_contato_cond (id_condominio),
  CONSTRAINT fk_contato_cond FOREIGN KEY (id_condominio) REFERENCES Condominios (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
