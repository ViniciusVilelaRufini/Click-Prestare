-- Integração Superlógica — escrita de condômino (mão dupla).
-- Complementa manual_2026-08_superlogica.sql e _crm.sql.
-- Ver INTEGRACAO_SUPERLOGICA.md.
--
-- Migração MANUAL (Railway = MySQL 8; não roda `prisma db push`/`migrate`).
-- Rodar UMA vez ANTES do deploy que inclui o envio de morador ao ERP.
--
-- superlogica_escrita: liga o envio de proprietário/morador do Clique para o
-- ERP, POR CONDOMÍNIO. Default 0 — nenhum condomínio escreve na Superlógica até
-- que alguém ligue explicitamente no CRM.
--
-- A coluna existe porque escrita é irreversível do lado de lá: o ERP é a
-- operação financeira real da administradora. Ligar tem que ser um ato
-- consciente, condomínio a condomínio, começando pelo de teste.
--
-- Reexecutar é seguro (no-op).

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE Condominios ADD COLUMN superlogica_escrita TINYINT NOT NULL DEFAULT 0',
    'SELECT "Condominios.superlogica_escrita ja existe"'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'Condominios'
    AND COLUMN_NAME = 'superlogica_escrita'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- id_superlogica_con em Moradores: id do contato criado no ERP. Serve de trava
-- de idempotência — morador já enviado não é reenviado, o que evitaria contato
-- duplicado na unidade a cada reedição.
SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE Moradores ADD COLUMN id_superlogica_con INT NULL',
    'SELECT "Moradores.id_superlogica_con ja existe"'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'Moradores'
    AND COLUMN_NAME = 'id_superlogica_con'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
