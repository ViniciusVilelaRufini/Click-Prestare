-- A8 (auth:jwt-not-revoked-on-password-reset)
-- Momento da última troca/redefinição de senha. A JwtStrategy recusa token de
-- usuário do app (e de síndico no console) com iat anterior a este momento.
-- APLICAR ANTES DO DEPLOY: sem a coluna, a troca de senha passa a dar 500.
ALTER TABLE Users ADD COLUMN senha_alterada_em DATETIME NULL DEFAULT NULL;
