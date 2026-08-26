-- Integração Superlógica — ativação pelo CRM.
-- Complementa manual_2026-08_superlogica.sql. Ver INTEGRACAO_SUPERLOGICA.md.
--
-- Migração MANUAL (Railway = MySQL 8; não roda `prisma db push`/`migrate`).
-- Rodar UMA vez ANTES do deploy que inclui as rotas /crm/superlogica/*.
--
-- Índice único em Condominios.id_superlogica_cond: um condomínio da Superlógica
-- só pode estar vinculado a UM condomínio do Clique. Sem isso, vincular o mesmo
-- id em dois prédios faria as duas sincronizações puxarem as mesmas cobranças —
-- moradores de um prédio veriam os boletos do outro.
--
-- A checagem também existe na aplicação (409 no vincular), mas ela sozinha tem
-- janela de corrida entre a consulta e a gravação. O índice fecha a janela.
--
-- Em MySQL, NULLs não colidem em índice único: qualquer quantidade de
-- condomínios pode continuar sem vínculo.
--
-- Reexecutar é seguro (no-op).

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'CREATE UNIQUE INDEX un_cond_superlogica ON Condominios (id_superlogica_cond)',
    'SELECT "un_cond_superlogica ja existe"'
  )
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'Condominios'
    AND INDEX_NAME = 'un_cond_superlogica'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
