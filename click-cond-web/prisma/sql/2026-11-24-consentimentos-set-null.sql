-- Consentimentos (D5, varredura 24/11): a prova do aceite fica depois da
-- exclusão da conta. Consentimentos.id_user passa a anulável e fk_consent_user
-- de ON DELETE CASCADE para ON DELETE SET NULL.
--
-- Por quê: 2026-09-11-consentimentos.sql criou a FK em CASCADE, então excluir a
-- conta apagava o histórico de aceites/recusas, contrariando a política de
-- guardar a prova do consentimento
-- (docs/operacao/classificacao-e-retencao-de-dados.md). Agora a linha fica com
-- id_user NULL (tipo, versão, aceito e data continuam).
--
-- APLICAR ANTES DO DEPLOY. Seguro com o código antigo no ar: o código só lê
-- consentimento filtrando por id_user = <conta logada> (as linhas com NULL não
-- voltam em nenhuma leitura) e só grava com id_user preenchido. A tabela
-- continua APPEND-ONLY: nada aqui faz UPDATE em linha existente.
--
-- O que faz:
--   1. drop da FK atual em id_user -> Users se ela NÃO for SET NULL (nome lido
--      do information_schema, não presumido);
--   2. id_user passa a INT NULL (SET NULL exige);
--   3. cria fk_consent_user ON DELETE SET NULL ON UPDATE CASCADE se não houver
--      FK SET NULL em id_user (o índice idx_consent_user_tipo começa por
--      id_user e serve à FK).
-- Entre 1 e 3 a coluna fica sem FK por instantes; se o script parar no meio,
-- basta rodar de novo.
--
-- Idempotente: cada passo confere o information_schema e vira no-op se já foi
-- aplicado. Rodar numa única sessão (usa @sql/@fk). MySQL 8.4. lock_wait_timeout
-- de 10 s: se outra sessão segurar o metadata lock, o ALTER desiste; rodar de
-- novo.

SET SESSION lock_wait_timeout = 10;

-- 1.
SET @fk = (
  SELECT kcu.CONSTRAINT_NAME
    FROM information_schema.KEY_COLUMN_USAGE kcu
    JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
      ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
     AND rc.TABLE_NAME = kcu.TABLE_NAME
     AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
   WHERE kcu.TABLE_SCHEMA = DATABASE()
     AND kcu.TABLE_NAME = 'Consentimentos'
     AND kcu.COLUMN_NAME = 'id_user'
     AND kcu.REFERENCED_TABLE_NAME = 'Users'
     AND rc.DELETE_RULE <> 'SET NULL'
   LIMIT 1);
SELECT @fk AS fk_id_user_a_trocar;
SET @sql = IF(
  @fk IS NOT NULL,
  CONCAT('ALTER TABLE `Consentimentos` DROP FOREIGN KEY `', @fk, '`'),
  'SELECT ''FK id_user: nenhuma fora de SET NULL'' AS passo_1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2.
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Consentimentos' AND COLUMN_NAME = 'id_user'
      AND IS_NULLABLE = 'NO') = 1,
  'ALTER TABLE `Consentimentos` MODIFY `id_user` INT NULL',
  'SELECT ''Consentimentos.id_user: ja e anulavel'' AS passo_2');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3. Só se ainda não existe FK SET NULL em id_user e a coluna já é anulável. Se
-- o nome fk_consent_user ainda estiver ocupado (FK antiga que o passo 1 não
-- removeu), o passo não roda: confira a verificação e rode de novo.
SET @sql = IF(
  (SELECT COUNT(*)
     FROM information_schema.KEY_COLUMN_USAGE kcu
     JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
       ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
      AND rc.TABLE_NAME = kcu.TABLE_NAME
      AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
    WHERE kcu.TABLE_SCHEMA = DATABASE()
      AND kcu.TABLE_NAME = 'Consentimentos'
      AND kcu.COLUMN_NAME = 'id_user'
      AND kcu.REFERENCED_TABLE_NAME = 'Users'
      AND rc.DELETE_RULE = 'SET NULL') = 0
  AND
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'Consentimentos'
      AND CONSTRAINT_NAME = 'fk_consent_user' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0
  AND
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Consentimentos' AND COLUMN_NAME = 'id_user'
      AND IS_NULLABLE = 'YES') = 1,
  'ALTER TABLE `Consentimentos` ADD CONSTRAINT `fk_consent_user` FOREIGN KEY (`id_user`) REFERENCES `Users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT ''fk_consent_user: ja e SET NULL (ou coluna ainda NOT NULL)'' AS passo_3');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
