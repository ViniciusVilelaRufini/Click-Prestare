-- Ocorrências: autoria da portaria (porteiro do console, suporte do CRM e
-- monitor de dispositivos) e chat do porteiro.
--
-- APLICAR ANTES DO DEPLOY do código que usa estas colunas. Se o código subir
-- primeiro, o Prisma passa a pedir Ocorrencias.origem /
-- id_funcionario_portaria e OcorrenciaMensagens.id_funcionario_portaria /
-- nome_autor em toda leitura: a lista de ocorrências e o chat falham (console
-- e app). Aplicar, rodar 2026-11-13-ocorrencias-portaria-verificacao.sql e só
-- então publicar.
--
-- Seguro com o código ANTIGO no ar: só adiciona colunas anuláveis sem default
-- e afrouxa OcorrenciaMensagens.id_usuario para aceitar NULL. O código antigo
-- não lê as colunas novas e continua gravando id_usuario em toda mensagem.
-- Nada é apagado nem reescrito.
--
-- O que faz:
--   1. Ocorrencias.origem VARCHAR(12) NULL — 'portaria' | 'crm' | 'sistema';
--      NULL = registro antigo ou aberto por usuário do app (coluna `user`).
--   2. Ocorrencias.id_funcionario_portaria INT NULL + índice + FK
--      fk_oco_func_portaria -> Funcionarios_Portaria(id) ON DELETE SET NULL
--      (porteiro removido: a ocorrência fica, sem o vínculo).
--   3. OcorrenciaMensagens.id_usuario passa a aceitar NULL (a mensagem do
--      porteiro não tem Users.id). A FK fk_msg_user continua como está.
--   4. OcorrenciaMensagens.id_funcionario_portaria INT NULL + índice + FK
--      fk_msg_func_portaria -> Funcionarios_Portaria(id) ON DELETE SET NULL.
--   5. OcorrenciaMensagens.nome_autor VARCHAR(120) NULL — retrato do nome de
--      quem escreveu, para a mensagem não ficar anônima se o porteiro sair.
--
-- Idempotente: cada passo confere o information_schema. Compatível com
-- MySQL 8.4. Tabelas pequenas (rebuild rápido).

SET SESSION lock_wait_timeout = 10;

-- 1. Ocorrencias.origem
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Ocorrencias' AND COLUMN_NAME = 'origem') = 0,
  'ALTER TABLE `Ocorrencias` ADD COLUMN `origem` VARCHAR(12) NULL AFTER `id_responsavel`',
  'SELECT ''Ocorrencias.origem: ja existe'' AS passo_1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. Ocorrencias.id_funcionario_portaria + índice + FK
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Ocorrencias' AND COLUMN_NAME = 'id_funcionario_portaria') = 0,
  'ALTER TABLE `Ocorrencias` ADD COLUMN `id_funcionario_portaria` INT NULL AFTER `origem`',
  'SELECT ''Ocorrencias.id_funcionario_portaria: ja existe'' AS passo_2');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Ocorrencias' AND INDEX_NAME = 'fk_oco_func_portaria') = 0,
  'ALTER TABLE `Ocorrencias` ADD INDEX `fk_oco_func_portaria` (`id_funcionario_portaria`)',
  'SELECT ''indice fk_oco_func_portaria: ja existe'' AS passo_2b');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'Ocorrencias'
      AND CONSTRAINT_NAME = 'fk_oco_func_portaria' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0,
  'ALTER TABLE `Ocorrencias` ADD CONSTRAINT `fk_oco_func_portaria` FOREIGN KEY (`id_funcionario_portaria`) REFERENCES `Funcionarios_Portaria` (`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT ''fk_oco_func_portaria: ja existe'' AS passo_2c');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3. OcorrenciaMensagens.id_usuario aceita NULL (mesmo tipo INT; a FK
-- fk_msg_user e o índice ficam como estão — o MySQL permite afrouxar o NOT
-- NULL de coluna com FK; o contrário é que é barrado).
-- Se este passo falhar com o erro 1832 ("Cannot change column ... used in a
-- foreign key constraint"), conferir antes o DELETE_RULE/UPDATE_RULE atuais
-- (SELECT em information_schema.REFERENTIAL_CONSTRAINTS para fk_msg_user) e
-- recriar a FK com as MESMAS regras em volta do MODIFY:
--   ALTER TABLE `OcorrenciaMensagens` DROP FOREIGN KEY `fk_msg_user`;
--   ALTER TABLE `OcorrenciaMensagens` MODIFY COLUMN `id_usuario` INT NULL;
--   ALTER TABLE `OcorrenciaMensagens` ADD CONSTRAINT `fk_msg_user` FOREIGN KEY (`id_usuario`)
--     REFERENCES `Users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'OcorrenciaMensagens' AND COLUMN_NAME = 'id_usuario'
      AND IS_NULLABLE = 'NO') = 1,
  'ALTER TABLE `OcorrenciaMensagens` MODIFY COLUMN `id_usuario` INT NULL',
  'SELECT ''OcorrenciaMensagens.id_usuario: ja aceita NULL'' AS passo_3');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4. OcorrenciaMensagens.id_funcionario_portaria + índice + FK
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'OcorrenciaMensagens' AND COLUMN_NAME = 'id_funcionario_portaria') = 0,
  'ALTER TABLE `OcorrenciaMensagens` ADD COLUMN `id_funcionario_portaria` INT NULL AFTER `id_usuario`',
  'SELECT ''OcorrenciaMensagens.id_funcionario_portaria: ja existe'' AS passo_4');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'OcorrenciaMensagens' AND INDEX_NAME = 'fk_msg_func_portaria') = 0,
  'ALTER TABLE `OcorrenciaMensagens` ADD INDEX `fk_msg_func_portaria` (`id_funcionario_portaria`)',
  'SELECT ''indice fk_msg_func_portaria: ja existe'' AS passo_4b');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'OcorrenciaMensagens'
      AND CONSTRAINT_NAME = 'fk_msg_func_portaria' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0,
  'ALTER TABLE `OcorrenciaMensagens` ADD CONSTRAINT `fk_msg_func_portaria` FOREIGN KEY (`id_funcionario_portaria`) REFERENCES `Funcionarios_Portaria` (`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT ''fk_msg_func_portaria: ja existe'' AS passo_4c');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 5. OcorrenciaMensagens.nome_autor
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'OcorrenciaMensagens' AND COLUMN_NAME = 'nome_autor') = 0,
  'ALTER TABLE `OcorrenciaMensagens` ADD COLUMN `nome_autor` VARCHAR(120) NULL AFTER `id_funcionario_portaria`',
  'SELECT ''OcorrenciaMensagens.nome_autor: ja existe'' AS passo_5');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
