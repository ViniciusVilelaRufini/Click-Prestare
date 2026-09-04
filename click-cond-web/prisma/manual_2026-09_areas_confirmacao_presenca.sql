-- Confirmação de presença nas áreas sociais — o morador confirma a reserva
-- ~30 min antes; sem confirmação a reserva cai e o horário é liberado.
--
-- Migração MANUAL (Railway = MySQL 8; não roda `prisma db push`/`migrate`).
--
-- O código destas duas colunas já tinha subido em deploy sem o SQL
-- correspondente, e o banco de produção ficou para trás. O sintoma foi
-- GET /areasSociais/get-all respondendo 500 — o `select` de getAll pede
-- `exige_confirmacao` e o Prisma aborta a query inteira quando a coluna não
-- existe, derrubando a aba "Terminais de Dispositivos" da portaria-web.
-- Aplicado na produção em 04/09/2026.
--
-- Ambas são aditivas e com valor de partida definido: nenhuma área muda de
-- comportamento (exige_confirmacao = 0 mantém a confirmação desligada até o
-- síndico ligar) e nenhuma reserva existente é cancelada por falta de
-- lembrete (lembrete_enviado_em NULL significa "o morador nunca teve como
-- confirmar", caso que o serviço já trata sem cancelar).
--
-- MySQL 8 não tem ADD COLUMN IF NOT EXISTS: reexecutar dá erro 1060
-- (Duplicate column name), que é inofensivo — significa que já foi aplicado.

ALTER TABLE `Areas_Sociais`
  ADD COLUMN `exige_confirmacao` TINYINT NOT NULL DEFAULT 0 AFTER `limite_mensal_apto`;

ALTER TABLE `Areas_Sociais_Agendamentos`
  ADD COLUMN `lembrete_enviado_em` DATETIME(0) NULL AFTER `confirmada_em`;
