-- Portaria remota / autorização de visitante em tempo real.
-- Migração MANUAL (Railway = MySQL 8; não roda `prisma db push`).
-- MySQL 8 NÃO suporta `ADD COLUMN IF NOT EXISTS` — rodar UMA vez.
-- Para aplicação idempotente/segura, use o script:
--   click-cond-api/click-cond-api/migrate_visitantes_auth.js

ALTER TABLE Visitantes
  ADD COLUMN auth_status VARCHAR(20) NULL,
  ADD COLUMN auth_solicitado_em DATETIME NULL,
  ADD COLUMN auth_respondido_em DATETIME NULL,
  ADD COLUMN auth_respondido_por INT NULL;

-- Acelera o inbox de pendentes (GET /visitantes/pendentes por apartamento).
CREATE INDEX idx_vis_auth_status ON Visitantes (auth_status);
