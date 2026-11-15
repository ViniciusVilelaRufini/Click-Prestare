-- Reservas de área social: quem agendou, separado de quem aprovou.
--
-- APLICAR ANTES DO DEPLOY do código que usa esta coluna. Se o código subir
-- primeiro, o Prisma passa a pedir Areas_Sociais_Agendamentos.criado_por_nome
-- em toda leitura e gravação de reserva: a fila do console, "minhas reservas"
-- do app e a criação de reserva falham. Aplicar, rodar
-- 2026-11-14-reserva-criado-por-verificacao.sql e só então publicar.
--
-- Seguro com o código ANTIGO no ar: só adiciona uma coluna anulável sem
-- default. O código antigo não a lê. Nada é apagado nem reescrito — as
-- reservas antigas ficam com criado_por_nome NULL (a tela mostra só o
-- "Aprovada por" que elas já tinham).
--
-- O que faz:
--   1. Areas_Sociais_Agendamentos.criado_por_nome VARCHAR(120) NULL — nome do
--      morador que reservou pelo app, "Portaria · <nome>" ou o nome do
--      síndico quando agendada pelo console em nome do morador.
--
-- Idempotente: confere o information_schema. Compatível com MySQL 8.4.
-- Tabela pequena (rebuild rápido).

SET SESSION lock_wait_timeout = 10;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Areas_Sociais_Agendamentos' AND COLUMN_NAME = 'criado_por_nome') = 0,
  'ALTER TABLE `Areas_Sociais_Agendamentos` ADD COLUMN `criado_por_nome` VARCHAR(120) NULL AFTER `motivo_recusa`',
  'SELECT ''Areas_Sociais_Agendamentos.criado_por_nome: ja existe'' AS passo_1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
