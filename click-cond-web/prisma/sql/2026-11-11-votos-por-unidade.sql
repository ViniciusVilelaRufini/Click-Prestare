-- Votacoes_Usuarios: o voto passa a gravar a UNIDADE pela qual foi dado.
--
-- APLICAR ANTES DO DEPLOY do código que grava/lê id_apto. Se o código subir
-- primeiro, o Prisma passa a pedir a coluna em toda consulta de voto: votar
-- falha ("Unknown column 'id_apto'") e o detalhe de enquete/assembleia também
-- (a apuração seleciona id_apto). Aplicar, rodar a verificação
-- (2026-11-11-votos-por-unidade-verificacao.sql) e só então publicar.
--
-- O que faz:
--   1. id_apto INT NULL   unidade (Apartamentos.id) do voto. Votos antigos
--      ficam NULL — sem backfill: a API conta esses pela unidade atribuída da
--      conta (menor id_apto dos vínculos em Apartamentos_Users), como antes.
--   2. índice idx_vu_apto_opcao (id_apto, id_opcao). A tabela não tem
--      id_votacao (a votação vem pela opção); o voto novo apaga
--      "id_apto = U AND id_opcao IN (opções da votação)". id_apto à esquerda
--      também serve de índice para a FK do passo 3.
--   3. FK fk_vu_apto -> Apartamentos(id) ON DELETE SET NULL (nunca cascata:
--      apagar um apartamento não apaga votos; o voto vira "antigo").
--      ON UPDATE CASCADE é o padrão do Prisma.
--   Sem índice único (id_opcao, id_apto): a coluna tem nulos antigos e dois
--   votos simultâneos são serializados pela API (SELECT ... FOR UPDATE na
--   linha do apartamento); duplicata residual é deduplicada na apuração.
--
-- Idempotente: cada passo confere o information_schema e vira no-op se já foi
-- aplicado, então pode rodar de novo (inteiro ou depois de parar no meio).
-- Rodar numa única sessão (usa variável @sql). Coluna anulável sem default:
-- não reescreve linhas; índice e FK são criados online no InnoDB.

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Votacoes_Usuarios' AND COLUMN_NAME = 'id_apto') = 0,
  'ALTER TABLE `Votacoes_Usuarios` ADD COLUMN `id_apto` INT NULL AFTER `id_user`',
  'SELECT ''id_apto: ja existe'' AS passo_1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Votacoes_Usuarios' AND INDEX_NAME = 'idx_vu_apto_opcao') = 0,
  'ALTER TABLE `Votacoes_Usuarios` ADD INDEX `idx_vu_apto_opcao` (`id_apto`, `id_opcao`)',
  'SELECT ''idx_vu_apto_opcao: ja existe'' AS passo_2');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Só cria a FK depois do índice (senão o MySQL cria um índice próprio com o
-- nome da constraint, que o Prisma não conhece).
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'Votacoes_Usuarios'
      AND CONSTRAINT_NAME = 'fk_vu_apto' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0
  AND
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Votacoes_Usuarios' AND INDEX_NAME = 'idx_vu_apto_opcao') > 0,
  'ALTER TABLE `Votacoes_Usuarios` ADD CONSTRAINT `fk_vu_apto` FOREIGN KEY (`id_apto`) REFERENCES `Apartamentos` (`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT ''fk_vu_apto: ja existe (ou indice ausente)'' AS passo_3');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
