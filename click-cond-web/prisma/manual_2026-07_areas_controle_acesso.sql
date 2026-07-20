-- Áreas sociais: controle de acesso por reserva no facial, SEPARADO de
-- id_area_social (que serve só p/ contar ocupação — pode ser a portaria).
-- Migração MANUAL (Railway/MySQL 8). Default 0 = nenhuma área gated (opt-in).
-- Rodar UMA vez (idempotência: ver migrate no click-cond-api se necessário).

ALTER TABLE Areas_Sociais
  ADD COLUMN controle_acesso_facial TINYINT(1) NOT NULL DEFAULT 0;
