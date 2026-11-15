-- Prestadores: permissões do app guardadas ao desligar o acesso à portaria.
--
-- Desligar a chave "Acesso Portaria Web" de um prestador apaga o vínculo de
-- equipe (Funcionarios) da conta dele neste condomínio; religar depois criava
-- o vínculo de novo com TODAS as permissões ligadas, e o que o síndico tinha
-- restringido no app se perdia. A linha do prestador fica entre desligar e
-- religar: é nela que as permissões passam a ser guardadas (JSON das 8 flags).
--
-- APLICAR ANTES DO DEPLOY do código que usa a coluna. Se o código subir
-- primeiro, o Prisma passa a pedir Prestadores_servico.permissoes_app_salvas
-- em toda leitura: a lista de prestadores (console e app) falha. Aplicar,
-- rodar 2026-11-14-prestador-permissoes-salvas-verificacao.sql e só então
-- publicar.
--
-- Seguro com o código ANTIGO no ar: só adiciona uma coluna anulável sem
-- default, que o código antigo não lê. Nada é apagado nem reescrito.
--
-- O que faz:
--   1. Prestadores_servico.permissoes_app_salvas TEXT NULL.
--
-- Idempotente: confere o information_schema. Compatível com MySQL 8.4.
-- Tabela pequena (rebuild rápido).

SET SESSION lock_wait_timeout = 10;

-- 1. Prestadores_servico.permissoes_app_salvas
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Prestadores_servico' AND COLUMN_NAME = 'permissoes_app_salvas') = 0,
  'ALTER TABLE `Prestadores_servico` ADD COLUMN `permissoes_app_salvas` TEXT NULL AFTER `face_sync_error`',
  'SELECT ''Prestadores_servico.permissoes_app_salvas: ja existe'' AS passo_1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
