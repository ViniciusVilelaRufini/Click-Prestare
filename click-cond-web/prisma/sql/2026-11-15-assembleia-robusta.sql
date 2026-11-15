-- Assembleia robusta: nada some, voto com retrato e trilha de substituição.
--
-- APLICAR ANTES DO DEPLOY do código que usa estas colunas. Se o código subir
-- primeiro, o Prisma passa a pedir as colunas novas em toda leitura de
-- assembleia, pauta e voto: a lista e o detalhe das assembleias e enquetes, o
-- voto e o encerramento falham ("Unknown column"). Aplicar, rodar
-- 2026-11-15-assembleia-robusta-verificacao.sql e só então publicar.
--
-- Seguro com o código ANTIGO no ar: só adiciona colunas anuláveis (ou com
-- default) e afrouxa id_user para anulável. O código antigo não lê as colunas
-- novas; grava Votacoes.somente_proprietarios = 0 pelo default. Nada é apagado
-- nem reescrito: assembleias, pautas e votos antigos ficam com as colunas novas
-- NULL (a API trata NULL como "voto antigo" / "não finalizada" / "não
-- encerrada"). Ressalva: entre este SQL e o deploy, a exclusão de conta pelo
-- código antigo já deixa o voto com id_user NULL (em vez de apagá-lo); o
-- Prisma antigo, que espera id_user NOT NULL, pode falhar ao ler esse voto no
-- detalhe da votação. Aplicar perto do deploy.
--
-- O que faz:
--   1. Assembleias.finalizada_em DATETIME NULL     quando foi finalizada com a ATA
--   2. Assembleias.finalizada_por INT NULL         Users.id de quem finalizou (sem FK)
--   3. Assembleias.id_documento_ata INT NULL       Documentos.id da ATA (sem FK)
--   4. Assembleias.apuracao_hash CHAR(64) NULL     SHA-256 do mapa de votação
--   5. Votacoes.encerrada_em DATETIME NULL         quando a votação foi encerrada
--   6. Votacoes.somente_proprietarios TINYINT NOT NULL DEFAULT 0
--   7. Votacoes_Usuarios.tipo_vinculo VARCHAR(20) NULL     retrato do voto
--   8. Votacoes_Usuarios.nome_votante VARCHAR(255) NULL
--   9. Votacoes_Usuarios.rotulo_unidade VARCHAR(120) NULL
--  10. Votacoes_Usuarios.substituido_em DATETIME NULL      trilha (voto trocado fica)
--  11. FK de Votacoes_Usuarios.id_user -> Users: ON DELETE CASCADE vira SET NULL
--      (excluir a conta não apaga mais os votos):
--      11a. drop da FK atual em id_user -> Users se ela NÃO for SET NULL (o
--           nome é lido do information_schema, não presumido);
--      11b. id_user passa a INT NULL;
--      11c. cria fk_vu_user ON DELETE SET NULL ON UPDATE CASCADE se não houver
--           FK SET NULL em id_user (o índice fk_vu_user já existe e continua).
--      Entre 11a e 11c a coluna fica sem FK por instantes; se o script parar
--      no meio, basta rodar de novo.
--   As FKs voto -> opção (fk_vu_op) e opção -> votação (fk_vo_vot) seguem em
--   cascata: a proteção contra apagar pauta/assembleia com voto é na API.
--
-- Idempotente: cada passo confere o information_schema e vira no-op se já foi
-- aplicado. Rodar numa única sessão (usa variáveis @sql/@fk). Compatível com
-- MySQL 8.4. Tabelas pequenas (dados de teste): os ALTER levam segundos. A FK
-- nova é criada por cópia da tabela (bloqueia escrita em Votacoes_Usuarios
-- durante a cópia).
--
-- lock_wait_timeout de 10 s: se outra sessão segurar o metadata lock da
-- tabela, o ALTER desiste em vez de enfileirar (e travar) os votos atrás dele.
-- Basta rodar de novo depois.

SET SESSION lock_wait_timeout = 10;

-- 1 a 4: Assembleias ---------------------------------------------------------

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Assembleias' AND COLUMN_NAME = 'finalizada_em') = 0,
  'ALTER TABLE `Assembleias` ADD COLUMN `finalizada_em` DATETIME NULL',
  'SELECT ''Assembleias.finalizada_em: ja existe'' AS passo_1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Assembleias' AND COLUMN_NAME = 'finalizada_por') = 0,
  'ALTER TABLE `Assembleias` ADD COLUMN `finalizada_por` INT NULL',
  'SELECT ''Assembleias.finalizada_por: ja existe'' AS passo_2');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Assembleias' AND COLUMN_NAME = 'id_documento_ata') = 0,
  'ALTER TABLE `Assembleias` ADD COLUMN `id_documento_ata` INT NULL',
  'SELECT ''Assembleias.id_documento_ata: ja existe'' AS passo_3');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Assembleias' AND COLUMN_NAME = 'apuracao_hash') = 0,
  'ALTER TABLE `Assembleias` ADD COLUMN `apuracao_hash` CHAR(64) NULL',
  'SELECT ''Assembleias.apuracao_hash: ja existe'' AS passo_4');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 5 e 6: Votacoes ------------------------------------------------------------

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Votacoes' AND COLUMN_NAME = 'encerrada_em') = 0,
  'ALTER TABLE `Votacoes` ADD COLUMN `encerrada_em` DATETIME NULL',
  'SELECT ''Votacoes.encerrada_em: ja existe'' AS passo_5');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Votacoes' AND COLUMN_NAME = 'somente_proprietarios') = 0,
  'ALTER TABLE `Votacoes` ADD COLUMN `somente_proprietarios` TINYINT NOT NULL DEFAULT 0',
  'SELECT ''Votacoes.somente_proprietarios: ja existe'' AS passo_6');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 7 a 10: Votacoes_Usuarios (retrato e trilha) -------------------------------

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Votacoes_Usuarios' AND COLUMN_NAME = 'tipo_vinculo') = 0,
  'ALTER TABLE `Votacoes_Usuarios` ADD COLUMN `tipo_vinculo` VARCHAR(20) NULL',
  'SELECT ''Votacoes_Usuarios.tipo_vinculo: ja existe'' AS passo_7');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Votacoes_Usuarios' AND COLUMN_NAME = 'nome_votante') = 0,
  'ALTER TABLE `Votacoes_Usuarios` ADD COLUMN `nome_votante` VARCHAR(255) NULL',
  'SELECT ''Votacoes_Usuarios.nome_votante: ja existe'' AS passo_8');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Votacoes_Usuarios' AND COLUMN_NAME = 'rotulo_unidade') = 0,
  'ALTER TABLE `Votacoes_Usuarios` ADD COLUMN `rotulo_unidade` VARCHAR(120) NULL',
  'SELECT ''Votacoes_Usuarios.rotulo_unidade: ja existe'' AS passo_9');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Votacoes_Usuarios' AND COLUMN_NAME = 'substituido_em') = 0,
  'ALTER TABLE `Votacoes_Usuarios` ADD COLUMN `substituido_em` DATETIME NULL',
  'SELECT ''Votacoes_Usuarios.substituido_em: ja existe'' AS passo_10');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 11: FK id_user -> Users de CASCADE para SET NULL ---------------------------

-- 11a. Nome REAL da FK em id_user -> Users que ainda não é SET NULL (NULL se
-- não houver). Só tabelas do information_schema na comparação.
SET @fk = (
  SELECT kcu.CONSTRAINT_NAME
    FROM information_schema.KEY_COLUMN_USAGE kcu
    JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
      ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
     AND rc.TABLE_NAME = kcu.TABLE_NAME
     AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
   WHERE kcu.TABLE_SCHEMA = DATABASE()
     AND kcu.TABLE_NAME = 'Votacoes_Usuarios'
     AND kcu.COLUMN_NAME = 'id_user'
     AND kcu.REFERENCED_TABLE_NAME = 'Users'
     AND rc.DELETE_RULE <> 'SET NULL'
   LIMIT 1);
SELECT @fk AS fk_id_user_a_trocar;
SET @sql = IF(
  @fk IS NOT NULL,
  CONCAT('ALTER TABLE `Votacoes_Usuarios` DROP FOREIGN KEY `', @fk, '`'),
  'SELECT ''FK id_user: nenhuma em CASCADE a remover'' AS passo_11a');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 11b. id_user anulável (SET NULL exige). Sem default, como antes.
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Votacoes_Usuarios' AND COLUMN_NAME = 'id_user'
      AND IS_NULLABLE = 'NO') = 1,
  'ALTER TABLE `Votacoes_Usuarios` MODIFY `id_user` INT NULL',
  'SELECT ''Votacoes_Usuarios.id_user: ja e anulavel'' AS passo_11b');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 11c. FK nova, só se ainda não existe uma SET NULL em id_user -> Users e a
-- coluna já é anulável. Se o nome fk_vu_user ainda estiver ocupado (FK antiga
-- com o mesmo nome que 11a não removeu), o passo não roda: confira a
-- verificação e rode o script de novo.
SET @sql = IF(
  (SELECT COUNT(*)
     FROM information_schema.KEY_COLUMN_USAGE kcu
     JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
       ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
      AND rc.TABLE_NAME = kcu.TABLE_NAME
      AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
    WHERE kcu.TABLE_SCHEMA = DATABASE()
      AND kcu.TABLE_NAME = 'Votacoes_Usuarios'
      AND kcu.COLUMN_NAME = 'id_user'
      AND kcu.REFERENCED_TABLE_NAME = 'Users'
      AND rc.DELETE_RULE = 'SET NULL') = 0
  AND
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'Votacoes_Usuarios'
      AND CONSTRAINT_NAME = 'fk_vu_user' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0
  AND
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Votacoes_Usuarios' AND COLUMN_NAME = 'id_user'
      AND IS_NULLABLE = 'YES') = 1,
  'ALTER TABLE `Votacoes_Usuarios` ADD CONSTRAINT `fk_vu_user` FOREIGN KEY (`id_user`) REFERENCES `Users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT ''fk_vu_user: ja e SET NULL (ou coluna ainda NOT NULL)'' AS passo_11c');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
