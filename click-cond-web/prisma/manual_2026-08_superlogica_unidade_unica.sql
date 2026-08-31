-- Integração Superlógica — índice único de unidade.
-- Complementa manual_2026-08_superlogica.sql e _crm.sql. Ver INTEGRACAO_SUPERLOGICA.md §6.
--
-- Migração MANUAL (Railway = MySQL 8; não roda `prisma db push`/`migrate`).
-- Rodar UMA vez no banco de produção, a qualquer momento (não depende de
-- nenhum deploy específico).
--
-- Índice único em Apartamentos (id_condominio, id_superlogica_uni): impede
-- dois apartamentos do mesmo condomínio carregarem o mesmo id_unidade_uni do
-- ERP. Sem isso, o Map de superlogica-sync.service.ts:201 guarda só o último
-- apartamento com aquele id, e as cobranças da unidade caem no apartamento
-- errado — em silêncio. É dinheiro de morador aparecendo na tela de outro.
--
-- Em MySQL, NULLs não colidem em índice único: a coluna é o interruptor de
-- ativação da integração (manual_2026-08_superlogica.sql), então todo
-- apartamento de condomínio ainda não vinculado ao ERP continua com
-- id_superlogica_uni NULL e não é afetado.
--
-- Reexecutar é seguro (no-op).

-- Diagnóstico — rodar ANTES de aplicar. Se retornar alguma linha, o
-- CREATE UNIQUE INDEX abaixo vai falhar (duplicate entry): resolva as
-- duplicatas na mão (qual apartamento é o certo para aquele id_unidade_uni)
-- antes de tentar de novo.
--
-- SELECT id_condominio, id_superlogica_uni, COUNT(*) AS qtd, GROUP_CONCAT(id) AS apartamentos
-- FROM Apartamentos
-- WHERE id_superlogica_uni IS NOT NULL
-- GROUP BY id_condominio, id_superlogica_uni
-- HAVING COUNT(*) > 1;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'CREATE UNIQUE INDEX un_apto_superlogica ON Apartamentos (id_condominio, id_superlogica_uni)',
    'SELECT "un_apto_superlogica ja existe"'
  )
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'Apartamentos'
    AND INDEX_NAME = 'un_apto_superlogica'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
