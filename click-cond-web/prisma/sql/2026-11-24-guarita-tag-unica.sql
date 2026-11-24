-- Guarita (G7, varredura 24/11): um controle por Guarita. Chave única
-- un_tag_guarita (id_device, guarita_tipo, guarita_serial) em Tags, no lugar do
-- índice comum idx_tag_guarita (mesmas colunas). Sem ela, duas confirmações de
-- captura ao mesmo tempo (duas instâncias) criavam duas tags para o mesmo
-- controle; com ela, a segunda recebe "já está cadastrado neste Guarita".
--
-- APLICAR ANTES DO DEPLOY. Seguro com o código antigo no ar: o código antigo já
-- confere o repetido antes de criar; a chave só barra a corrida.
--
-- NULL não conflita (MySQL): tag comum (id_device NULL) e tag aguardando
-- aprovação (guarita_tipo NULL) continuam livres.
--
-- Duplicatas já existentes NÃO são apagadas aqui (a tag está ligada a veículo
-- e a operações). Se o passo 1 listar alguma linha, o ADD UNIQUE do passo 2
-- falha com "Duplicate entry" e nada muda: resolver à mão (desfazer uma das
-- tags no console) e rodar de novo.
--
-- Ordem: a chave única entra ANTES de sair o índice antigo — a FK
-- fk_tag_guarita_device (id_device) precisa de um índice que comece por
-- id_device o tempo todo.
--
-- Idempotente: cada passo confere o information_schema e vira no-op se já foi
-- aplicado. Rodar numa única sessão (usa @sql). MySQL 8.4.

SET SESSION lock_wait_timeout = 10;

-- 1. Informativo: duplicatas que impediriam a chave (esperado: nenhuma linha).
SELECT id_device, guarita_tipo, guarita_serial, COUNT(*) AS n, GROUP_CONCAT(id ORDER BY id) AS ids
  FROM `Tags`
 WHERE id_device IS NOT NULL AND guarita_tipo IS NOT NULL AND guarita_serial IS NOT NULL
 GROUP BY id_device, guarita_tipo, guarita_serial
HAVING COUNT(*) > 1;

-- 2. Chave única nova.
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Tags' AND INDEX_NAME = 'un_tag_guarita') = 0,
  'ALTER TABLE `Tags` ADD UNIQUE KEY `un_tag_guarita` (`id_device`, `guarita_tipo`, `guarita_serial`)',
  'SELECT ''un_tag_guarita: ja existe'' AS passo_2');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3. Índice antigo (mesmas colunas, redundante) sai — só depois da chave existir.
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Tags' AND INDEX_NAME = 'idx_tag_guarita') > 0
  AND
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Tags' AND INDEX_NAME = 'un_tag_guarita') > 0,
  'ALTER TABLE `Tags` DROP INDEX `idx_tag_guarita`',
  'SELECT ''idx_tag_guarita: ja saiu (ou a chave nova nao existe)'' AS passo_3');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
