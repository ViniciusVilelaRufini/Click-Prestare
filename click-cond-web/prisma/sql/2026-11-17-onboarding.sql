-- Onboarding (bloqueadores 2 e 1): Condominios.aprovado_em e chave unica em
-- Sindicos_Condominios.
--
-- APLICAR ANTES DO DEPLOY do codigo. Se o codigo subir primeiro, o Prisma pede
-- a coluna aprovado_em em toda leitura de Condominios e tudo falha ("Unknown
-- column"). Aplicar, rodar 2026-11-17-onboarding-verificacao.sql e so entao
-- publicar.
--
-- Seguro com o codigo ANTIGO no ar: a coluna nova e anulavel e o codigo antigo
-- nao a le; a chave unica so barra vinculo duplicado de sindico, que o codigo
-- antigo nao cria de proposito.
--
-- O que faz:
--   1. Condominios.aprovado_em DATETIME NULL. Pendente (autocadastro "em
--      analise") = ativo = 0 AND aprovado_em IS NULL. Desativado no CRM =
--      ativo = 0 com aprovado_em preenchido.
--   2. Quem ja esta ativo = 1 recebe aprovado_em = created_at (ou NOW()), senao
--      um futuro "desativar" viraria "em analise" por engano. Condominios hoje
--      ativo = 0 NAO sao tocados: ficam como "em analise" (o autocadastro
--      sempre gravou ativo = 0) ate o CRM ativar. Se algum deles foi desativado
--      no CRM e nao deve aparecer como "em analise", conferir o item
--      informativo da verificacao e preencher aprovado_em a mao.
--   3. Sindicos_Condominios: apaga duplicatas (id_user, id_condominio) mantendo
--      o MENOR id e cria a chave unica uq_sindico_condominio.
--
-- Idempotente: cada passo confere o information_schema e vira no-op se ja foi
-- aplicado (o UPDATE e o DELETE sao naturalmente repetiveis). Rodar numa unica
-- sessao (usa @sql). Compativel com MySQL 8.4.
--
-- lock_wait_timeout de 10 s: se outra sessao segurar o metadata lock, o ALTER
-- desiste em vez de enfileirar as leituras atras dele. Basta rodar de novo.

SET SESSION lock_wait_timeout = 10;

-- 1. Condominios.aprovado_em ---------------------------------------------------

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Condominios' AND COLUMN_NAME = 'aprovado_em') = 0,
  'ALTER TABLE `Condominios` ADD COLUMN `aprovado_em` DATETIME NULL',
  'SELECT ''Condominios.aprovado_em: ja existe'' AS passo_1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. Quem ja esta ativo foi aprovado ------------------------------------------

UPDATE `Condominios`
   SET `aprovado_em` = COALESCE(`created_at`, NOW())
 WHERE `ativo` = 1 AND `aprovado_em` IS NULL;

-- 3. Sindicos_Condominios: duplicatas e chave unica ----------------------------

-- Mantem o menor id de cada par (id_user, id_condominio).
DELETE sc FROM `Sindicos_Condominios` sc
  JOIN `Sindicos_Condominios` menor
    ON menor.`id_user` = sc.`id_user`
   AND menor.`id_condominio` = sc.`id_condominio`
   AND menor.`id` < sc.`id`;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Sindicos_Condominios'
      AND INDEX_NAME = 'uq_sindico_condominio') = 0,
  'ALTER TABLE `Sindicos_Condominios` ADD UNIQUE KEY `uq_sindico_condominio` (`id_user`, `id_condominio`)',
  'SELECT ''Sindicos_Condominios.uq_sindico_condominio: ja existe'' AS passo_3');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
