-- =============================================================================================
-- PROPOSTA — NÃO APLICADO. Não rodar sem decisão do dono (auditoria run-3, lote 2, S21).
-- Fingerprints: db-runtime-user-master-privileges + db-transport-tls-not-required.
-- Objetivo: a API deixa de conectar como o usuário master do RDS. Usuário `click_app` só com DML
-- (+ EXECUTE) no schema click_prestare, sem DDL, sem GRANT, sem acesso a outros schemas, e
-- exigindo TLS. Migrações manuais e o túnel seguem com o usuário administrativo (break-glass).
-- Passo a passo completo (ordem, verificação e volta): docs/operacao/2026-11-12-PROPOSTA-usuario-app-e-tls.md
-- A senha NUNCA é versionada: troque <GERAR_NA_HORA> no próprio terminal (CloudShell) na hora de
-- rodar e não salve o arquivo editado.
-- =============================================================================================

-- 0. Conferências somente leitura (rodar antes, com o usuário administrativo).
SELECT user, host, ssl_type FROM mysql.user WHERE user = 'click_app';
SHOW VARIABLES LIKE 'require_secure_transport';
SHOW STATUS LIKE 'Ssl_cipher';

-- 1. Usuário da aplicação, exigindo TLS na conexão.
CREATE USER 'click_app'@'%' IDENTIFIED BY '<GERAR_NA_HORA>' REQUIRE SSL;

-- 2. Somente DML + EXECUTE no schema da aplicação. Sem CREATE/ALTER/DROP/INDEX/REFERENCES/
--    CREATE TEMPORARY TABLES/LOCK TABLES/GRANT OPTION: o runtime não executa DDL (as migrações são
--    SQL manual com o usuário administrativo) e GET_LOCK não exige privilégio.
GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE ON click_prestare.* TO 'click_app'@'%';

-- 3. Conferir.
SHOW GRANTS FOR 'click_app'@'%';

-- Volta (se a API não subir com o usuário novo): restaurar a DATABASE_URL anterior no SSM,
-- reiniciar o EB e, se for desistir de vez:
-- DROP USER 'click_app'@'%';
