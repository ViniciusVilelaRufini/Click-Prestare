-- audit_logs: autor por id + tipo, e índice composto (condomínio, data).
--
-- APLICAR ANTES DO DEPLOY do código que grava autor_id/autor_tipo. Se o código
-- subir primeiro, TODO auditLog.create falha com "Unknown column 'autor_id'":
-- o erro é engolido (console.error em AuditoriaService / AuditInterceptor), as
-- requisições seguem funcionando e os registros de auditoria desse intervalo
-- SE PERDEM, sem alerta. Aplicar, rodar a verificação
-- (2026-11-10-audit-logs-autor-verificacao.sql) e só então publicar.
--
-- O que faz:
--   1. autor_id   INT NULL          id de quem fez a ação
--   2. autor_tipo VARCHAR(30) NULL  em qual tabela o id vive:
--        'funcionario_portaria' = Funcionarios_Portaria.id
--        'user'                 = Users.id (síndico, morador, funcionário do app)
--        'crm_admin'            = crm_admins.id
--        'sistema'              = job/automação, sem id
--      Registros antigos ficam com os dois NULL (não há backfill: nome/e-mail
--      não identificam a pessoa com segurança).
--   3. índice idx_audit_condo_created (id_condominio, created_at)
--   4. remove idx_audit_condo (id_condominio): vira prefixo do índice novo.
--      A ordem importa: cria o composto ANTES de remover o simples.
--
-- Idempotente: cada passo confere o information_schema e vira no-op se já foi
-- aplicado, então pode rodar de novo (inteiro ou depois de parar no meio).
-- Rodar numa única sessão (usa variável @sql). Colunas anuláveis sem default:
-- não reescreve linhas; a criação do índice é online no InnoDB.

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'autor_id') = 0,
  'ALTER TABLE `audit_logs` ADD COLUMN `autor_id` INT NULL AFTER `usuario_email`',
  'SELECT ''autor_id: ja existe'' AS passo_1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'autor_tipo') = 0,
  'ALTER TABLE `audit_logs` ADD COLUMN `autor_tipo` VARCHAR(30) NULL AFTER `autor_id`',
  'SELECT ''autor_tipo: ja existe'' AS passo_2');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs' AND INDEX_NAME = 'idx_audit_condo_created') = 0,
  'ALTER TABLE `audit_logs` ADD INDEX `idx_audit_condo_created` (`id_condominio`, `created_at`)',
  'SELECT ''idx_audit_condo_created: ja existe'' AS passo_3');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Só remove o índice simples se o composto existir (não deixa a tabela sem índice por condomínio).
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs' AND INDEX_NAME = 'idx_audit_condo') > 0
  AND
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs' AND INDEX_NAME = 'idx_audit_condo_created') > 0,
  'ALTER TABLE `audit_logs` DROP INDEX `idx_audit_condo`',
  'SELECT ''idx_audit_condo: ja removido (ou composto ausente)'' AS passo_4');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
