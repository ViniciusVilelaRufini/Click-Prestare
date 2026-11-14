-- Entregador com autoatendimento no portão
-- (docs/superpowers/specs/2026-11-13-entregador-autoatendimento-portao-design.md).
--
-- Migração manual idempotente para MySQL 8 (RDS): pode ser reaplicada sem
-- recriar tabela, colunas, índices ou constraints. Execute ANTES do deploy da
-- API. Sem AFTER <coluna> nos ALTER: nenhum depende de outra coluna existir.

SET @dpp_schema = DATABASE();

-- ───────────────────────── delivery_atendimentos

-- Atendimento criado pelo autoatendimento nasce sem dono (o primeiro morador
-- que responde vira o dono). MODIFY é seguro repetido; a FK para Users segue.
ALTER TABLE delivery_atendimentos MODIFY id_morador_user INT NULL;

SET @dpp_sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @dpp_schema
      AND TABLE_NAME = 'delivery_atendimentos'
      AND COLUMN_NAME = 'origem'
  ),
  'SELECT 1',
  'ALTER TABLE delivery_atendimentos ADD COLUMN origem VARCHAR(20) NOT NULL DEFAULT ''portaria'''
);
PREPARE dpp_stmt FROM @dpp_sql;
EXECUTE dpp_stmt;
DEALLOCATE PREPARE dpp_stmt;

-- Pedido de portão ativo. Sem FK de propósito (referência circular).
SET @dpp_sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @dpp_schema
      AND TABLE_NAME = 'delivery_atendimentos'
      AND COLUMN_NAME = 'id_pedido_portao'
  ),
  'SELECT 1',
  'ALTER TABLE delivery_atendimentos ADD COLUMN id_pedido_portao INT NULL'
);
PREPARE dpp_stmt FROM @dpp_sql;
EXECUTE dpp_stmt;
DEALLOCATE PREPARE dpp_stmt;

-- ───────────────────────── Facial_Devices

SET @dpp_sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @dpp_schema
      AND TABLE_NAME = 'Facial_Devices'
      AND COLUMN_NAME = 'token_entrega'
  ),
  'SELECT 1',
  'ALTER TABLE Facial_Devices ADD COLUMN token_entrega VARCHAR(64) NULL'
);
PREPARE dpp_stmt FROM @dpp_sql;
EXECUTE dpp_stmt;
DEALLOCATE PREPARE dpp_stmt;

SET @dpp_sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = @dpp_schema
      AND TABLE_NAME = 'Facial_Devices'
      AND INDEX_NAME = 'un_facdev_token_entrega'
  ),
  'SELECT 1',
  'ALTER TABLE Facial_Devices ADD UNIQUE KEY un_facdev_token_entrega (token_entrega)'
);
PREPARE dpp_stmt FROM @dpp_sql;
EXECUTE dpp_stmt;
DEALLOCATE PREPARE dpp_stmt;

-- ───────────────────────── Condominios

SET @dpp_sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @dpp_schema
      AND TABLE_NAME = 'Condominios'
      AND COLUMN_NAME = 'delivery_autoatendimento'
  ),
  'SELECT 1',
  'ALTER TABLE Condominios ADD COLUMN delivery_autoatendimento TINYINT(1) NOT NULL DEFAULT 0'
);
PREPARE dpp_stmt FROM @dpp_sql;
EXECUTE dpp_stmt;
DEALLOCATE PREPARE dpp_stmt;

SET @dpp_sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @dpp_schema
      AND TABLE_NAME = 'Condominios'
      AND COLUMN_NAME = 'delivery_auto_inicio'
  ),
  'SELECT 1',
  'ALTER TABLE Condominios ADD COLUMN delivery_auto_inicio VARCHAR(5) NULL'
);
PREPARE dpp_stmt FROM @dpp_sql;
EXECUTE dpp_stmt;
DEALLOCATE PREPARE dpp_stmt;

SET @dpp_sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @dpp_schema
      AND TABLE_NAME = 'Condominios'
      AND COLUMN_NAME = 'delivery_auto_fim'
  ),
  'SELECT 1',
  'ALTER TABLE Condominios ADD COLUMN delivery_auto_fim VARCHAR(5) NULL'
);
PREPARE dpp_stmt FROM @dpp_sql;
EXECUTE dpp_stmt;
DEALLOCATE PREPARE dpp_stmt;

-- ───────────────────────── delivery_pedidos_portao

CREATE TABLE IF NOT EXISTS delivery_pedidos_portao (
  id INT NOT NULL AUTO_INCREMENT,
  id_atendimento INT NOT NULL,
  id_device INT NOT NULL,
  nome VARCHAR(80) NOT NULL,
  plataforma VARCHAR(40) NULL,
  foto VARCHAR(500) NULL,
  token_hash VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pendente',
  visto_em DATETIME NULL,
  liberado_ate DATETIME NULL,
  aberto_em DATETIME NULL,
  saida_aberta_em DATETIME NULL,
  falha_abertura_em DATETIME NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira_em DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY un_delivery_pedido_token (token_hash),
  KEY idx_delivery_pedido_atendimento (id_atendimento),
  KEY idx_delivery_pedido_device_criado (id_device, criado_em),
  KEY idx_delivery_pedido_status_expira (status, expira_em),
  CONSTRAINT fk_delivery_pedido_atendimento FOREIGN KEY (id_atendimento) REFERENCES delivery_atendimentos(id) ON DELETE CASCADE,
  CONSTRAINT fk_delivery_pedido_device FOREIGN KEY (id_device) REFERENCES Facial_Devices(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Conferência (somente leitura), depois de aplicar:
--   SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS
--    WHERE TABLE_SCHEMA = DATABASE()
--      AND ((TABLE_NAME = 'delivery_atendimentos' AND COLUMN_NAME IN ('id_morador_user', 'origem', 'id_pedido_portao'))
--        OR (TABLE_NAME = 'Facial_Devices' AND COLUMN_NAME = 'token_entrega')
--        OR (TABLE_NAME = 'Condominios' AND COLUMN_NAME LIKE 'delivery_auto%'));
--   SHOW CREATE TABLE delivery_pedidos_portao;
