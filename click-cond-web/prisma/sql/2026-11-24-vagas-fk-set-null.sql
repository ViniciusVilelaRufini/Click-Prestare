-- Vagas (D1, varredura 24/11): fk_vaga_benef e fk_vaga_veiculo passam a
-- ON DELETE SET NULL.
--
-- Por quê: as duas FKs foram criadas sem ON DELETE (DEPLOY_VAGAS.md), ou seja
-- RESTRICT. Revogar a vaga só faz ativo = 0, a linha fica. Então:
--   - o morador que já recebeu vaga (beneficiário) não podia ser removido
--     (400 P2003) nem excluir a própria conta (500 no POST /users/delete-account,
--     requisito da Play Store);
--   - o veículo que já esteve numa vaga não podia ser excluído.
-- Com SET NULL a vaga antiga fica, sem o beneficiário/veículo apagado (a placa
-- continua gravada em Vagas.placa). Mesma saída que a purga do CRM já fazia à
-- mão (crm-condominios.service.ts, Vagas.updateMany antes de apagar).
--
-- APLICAR ANTES DO DEPLOY. Seguro com o código antigo no ar: as duas colunas já
-- são anuláveis e o código não depende do RESTRICT (ao contrário: hoje ele falha
-- por causa dele).
--
-- O que faz, para cada FK (id_morador_beneficiario -> Moradores e
-- id_veiculo -> Veiculos):
--   a. drop da FK atual da coluna se ela NÃO for SET NULL (nome lido do
--      information_schema, não presumido);
--   b. cria a FK com o nome do schema ON DELETE SET NULL ON UPDATE CASCADE se
--      não houver FK SET NULL na coluna (o índice de mesmo nome continua e serve
--      à FK nova).
-- Entre a e b a coluna fica sem FK por instantes; se o script parar no meio,
-- basta rodar de novo.
--
-- Idempotente: cada passo confere o information_schema e vira no-op se já foi
-- aplicado. Rodar numa única sessão (usa @sql/@fk). MySQL 8.4. A FK nova é
-- criada por cópia da tabela (bloqueia escrita em Vagas durante a cópia; tabela
-- pequena). lock_wait_timeout de 10 s: se outra sessão segurar o metadata lock,
-- o ALTER desiste em vez de enfileirar as gravações atrás dele; rodar de novo.

SET SESSION lock_wait_timeout = 10;

-- Informativo: vagas que hoje travam exclusões.
SELECT COUNT(*) AS vagas_com_beneficiario_ou_veiculo
  FROM `Vagas` WHERE id_morador_beneficiario IS NOT NULL OR id_veiculo IS NOT NULL;

-- 1. fk_vaga_benef (id_morador_beneficiario -> Moradores) ---------------------

-- 1a.
SET @fk = (
  SELECT kcu.CONSTRAINT_NAME
    FROM information_schema.KEY_COLUMN_USAGE kcu
    JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
      ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
     AND rc.TABLE_NAME = kcu.TABLE_NAME
     AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
   WHERE kcu.TABLE_SCHEMA = DATABASE()
     AND kcu.TABLE_NAME = 'Vagas'
     AND kcu.COLUMN_NAME = 'id_morador_beneficiario'
     AND kcu.REFERENCED_TABLE_NAME = 'Moradores'
     AND rc.DELETE_RULE <> 'SET NULL'
   LIMIT 1);
SELECT @fk AS fk_beneficiario_a_trocar;
SET @sql = IF(
  @fk IS NOT NULL,
  CONCAT('ALTER TABLE `Vagas` DROP FOREIGN KEY `', @fk, '`'),
  'SELECT ''FK id_morador_beneficiario: nenhuma fora de SET NULL'' AS passo_1a');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 1b.
SET @sql = IF(
  (SELECT COUNT(*)
     FROM information_schema.KEY_COLUMN_USAGE kcu
     JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
       ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
      AND rc.TABLE_NAME = kcu.TABLE_NAME
      AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
    WHERE kcu.TABLE_SCHEMA = DATABASE()
      AND kcu.TABLE_NAME = 'Vagas'
      AND kcu.COLUMN_NAME = 'id_morador_beneficiario'
      AND kcu.REFERENCED_TABLE_NAME = 'Moradores'
      AND rc.DELETE_RULE = 'SET NULL') = 0
  AND
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'Vagas'
      AND CONSTRAINT_NAME = 'fk_vaga_benef' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0,
  'ALTER TABLE `Vagas` ADD CONSTRAINT `fk_vaga_benef` FOREIGN KEY (`id_morador_beneficiario`) REFERENCES `Moradores` (`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT ''fk_vaga_benef: ja e SET NULL'' AS passo_1b');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. fk_vaga_veiculo (id_veiculo -> Veiculos) ---------------------------------

-- 2a.
SET @fk = (
  SELECT kcu.CONSTRAINT_NAME
    FROM information_schema.KEY_COLUMN_USAGE kcu
    JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
      ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
     AND rc.TABLE_NAME = kcu.TABLE_NAME
     AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
   WHERE kcu.TABLE_SCHEMA = DATABASE()
     AND kcu.TABLE_NAME = 'Vagas'
     AND kcu.COLUMN_NAME = 'id_veiculo'
     AND kcu.REFERENCED_TABLE_NAME = 'Veiculos'
     AND rc.DELETE_RULE <> 'SET NULL'
   LIMIT 1);
SELECT @fk AS fk_veiculo_a_trocar;
SET @sql = IF(
  @fk IS NOT NULL,
  CONCAT('ALTER TABLE `Vagas` DROP FOREIGN KEY `', @fk, '`'),
  'SELECT ''FK id_veiculo: nenhuma fora de SET NULL'' AS passo_2a');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2b.
SET @sql = IF(
  (SELECT COUNT(*)
     FROM information_schema.KEY_COLUMN_USAGE kcu
     JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
       ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
      AND rc.TABLE_NAME = kcu.TABLE_NAME
      AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
    WHERE kcu.TABLE_SCHEMA = DATABASE()
      AND kcu.TABLE_NAME = 'Vagas'
      AND kcu.COLUMN_NAME = 'id_veiculo'
      AND kcu.REFERENCED_TABLE_NAME = 'Veiculos'
      AND rc.DELETE_RULE = 'SET NULL') = 0
  AND
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'Vagas'
      AND CONSTRAINT_NAME = 'fk_vaga_veiculo' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0,
  'ALTER TABLE `Vagas` ADD CONSTRAINT `fk_vaga_veiculo` FOREIGN KEY (`id_veiculo`) REFERENCES `Veiculos` (`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT ''fk_vaga_veiculo: ja e SET NULL'' AS passo_2b');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
