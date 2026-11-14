-- Passe do morador na carteira do celular (Apple Wallet): opção por
-- condomínio, instante da última mudança do passe e aparelhos registrados no
-- serviço de atualização da Apple.
-- Migração manual idempotente para MySQL 8 (RDS): pode ser reaplicada sem
-- recriar tabelas, colunas ou constraints. Execute DEPOIS de
-- manual_2026-11_credenciais_acesso.sql e antes do deploy da API.

SET @wal_schema = DATABASE();

-- Pré-requisito: a tabela de credenciais do QR dinâmico. Sem ela, o PREPARE
-- abaixo falha com "Table '<banco>.ERRO: rode antes manual_2026-11_credenciais_acesso.sql' doesn't exist"
-- e nada mais é executado.
SET @wal_sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = @wal_schema
      AND TABLE_NAME = 'Credenciais_Acesso'
  ),
  'SELECT 1',
  'SELECT 1 FROM `ERRO: rode antes manual_2026-11_credenciais_acesso.sql`'
);
PREPARE wal_stmt FROM @wal_sql;
EXECUTE wal_stmt;
DEALLOCATE PREPARE wal_stmt;

-- Opção "Passe na carteira", desligada por padrão. Sem AFTER <coluna>: o
-- ALTER não depende de outra coluna existir neste banco.
SET @wal_sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @wal_schema
      AND TABLE_NAME = 'Condominios'
      AND COLUMN_NAME = 'wallet_habilitado'
  ),
  'SELECT 1',
  'ALTER TABLE Condominios ADD COLUMN wallet_habilitado TINYINT(1) NOT NULL DEFAULT 0'
);
PREPARE wal_stmt FROM @wal_sql;
EXECUTE wal_stmt;
DEALLOCATE PREPARE wal_stmt;

-- Instante da última mudança do passe (milissegundos).
SET @wal_sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @wal_schema
      AND TABLE_NAME = 'Credenciais_Acesso'
      AND COLUMN_NAME = 'wallet_atualizado_em'
  ),
  'SELECT 1',
  'ALTER TABLE Credenciais_Acesso ADD COLUMN wallet_atualizado_em DATETIME(3) NULL'
);
PREPARE wal_stmt FROM @wal_sql;
EXECUTE wal_stmt;
DEALLOCATE PREPARE wal_stmt;

-- Aparelhos registrados para cada passe (serviço de atualização da Apple).
CREATE TABLE IF NOT EXISTS Wallet_Registros (
  id INT NOT NULL AUTO_INCREMENT,
  id_credencial INT NOT NULL,
  device_id VARCHAR(100) NOT NULL,
  push_token VARCHAR(200) NOT NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY un_walreg (device_id, id_credencial),
  KEY idx_walreg_cred (id_credencial),
  CONSTRAINT fk_walreg_cred FOREIGN KEY (id_credencial) REFERENCES Credenciais_Acesso(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
