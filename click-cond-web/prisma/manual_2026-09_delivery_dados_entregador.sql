-- Dados opcionais do entregador informados pelo morador no aviso inicial e
-- correção da trilha de auditoria. Migração manual idempotente para
-- MySQL 8/Railway: pode ser reaplicada sem recriar colunas ou constraints.

SET @delivery_schema = DATABASE();

SET @delivery_sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @delivery_schema
      AND TABLE_NAME = 'delivery_atendimentos'
      AND COLUMN_NAME = 'nome_entregador'
  ),
  'SELECT 1',
  'ALTER TABLE delivery_atendimentos ADD COLUMN nome_entregador VARCHAR(255) NULL AFTER observacao_morador'
);
PREPARE delivery_stmt FROM @delivery_sql;
EXECUTE delivery_stmt;
DEALLOCATE PREPARE delivery_stmt;

SET @delivery_sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @delivery_schema
      AND TABLE_NAME = 'delivery_atendimentos'
      AND COLUMN_NAME = 'telefone_entregador'
  ),
  'SELECT 1',
  'ALTER TABLE delivery_atendimentos ADD COLUMN telefone_entregador VARCHAR(50) NULL AFTER nome_entregador'
);
PREPARE delivery_stmt FROM @delivery_sql;
EXECUTE delivery_stmt;
DEALLOCATE PREPARE delivery_stmt;

-- Uma exclusão do atendimento não pode apagar seus eventos auditáveis.
-- Instalações que receberam a versão anterior (CASCADE) são corrigidas;
-- instalações novas já nascem com RESTRICT no script principal.
SET @delivery_fk_delete_rule = (
  SELECT DELETE_RULE
  FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = @delivery_schema
    AND TABLE_NAME = 'delivery_eventos'
    AND CONSTRAINT_NAME = 'fk_delivery_evento_atendimento'
  LIMIT 1
);

SET @delivery_sql = IF(
  @delivery_fk_delete_rule IS NOT NULL
    AND @delivery_fk_delete_rule NOT IN ('RESTRICT', 'NO ACTION'),
  'ALTER TABLE delivery_eventos DROP FOREIGN KEY fk_delivery_evento_atendimento',
  'SELECT 1'
);
PREPARE delivery_stmt FROM @delivery_sql;
EXECUTE delivery_stmt;
DEALLOCATE PREPARE delivery_stmt;

SET @delivery_sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = @delivery_schema
      AND TABLE_NAME = 'delivery_eventos'
      AND CONSTRAINT_NAME = 'fk_delivery_evento_atendimento'
  ),
  'SELECT 1',
  'ALTER TABLE delivery_eventos ADD CONSTRAINT fk_delivery_evento_atendimento FOREIGN KEY (id_atendimento) REFERENCES delivery_atendimentos(id) ON DELETE RESTRICT'
);
PREPARE delivery_stmt FROM @delivery_sql;
EXECUTE delivery_stmt;
DEALLOCATE PREPARE delivery_stmt;
