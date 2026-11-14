-- QR dinâmico como credencial de acesso (morador no app e link do visitante).
-- Migração manual idempotente para MySQL 8 (RDS): pode ser reaplicada sem
-- recriar tabelas, colunas ou constraints. Execute antes do deploy da API.

SET @cred_schema = DATABASE();

-- Opção por condomínio "QR no app", desligada por padrão.
SET @cred_sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @cred_schema
      AND TABLE_NAME = 'Condominios'
      AND COLUMN_NAME = 'qr_app_habilitado'
  ),
  'SELECT 1',
  'ALTER TABLE Condominios ADD COLUMN qr_app_habilitado TINYINT(1) NOT NULL DEFAULT 0 AFTER dias_atraso_aviso_3'
);
PREPARE cred_stmt FROM @cred_sql;
EXECUTE cred_stmt;
DEALLOCATE PREPARE cred_stmt;

-- Credencial: segredo (cifrado por encryptSecret) a partir do qual o código
-- de 30 s é gerado. Uma ativa por pessoa, condomínio e origem.
CREATE TABLE IF NOT EXISTS Credenciais_Acesso (
  id INT NOT NULL AUTO_INCREMENT,
  id_condominio INT NOT NULL,
  tipo_pessoa VARCHAR(20) NOT NULL,
  id_pessoa INT NULL,
  id_visita INT NULL,
  id_visitante INT NULL,
  segredo VARCHAR(255) NOT NULL,
  origem VARCHAR(20) NOT NULL DEFAULT 'app',
  versao_link INT NOT NULL DEFAULT 1,
  valido_de DATETIME NULL,
  valido_ate DATETIME NULL,
  revogada_em DATETIME NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_cred_pessoa (id_condominio, tipo_pessoa, id_pessoa, origem),
  KEY idx_cred_visita (id_visita),
  KEY idx_cred_visitante (id_visitante),
  CONSTRAINT fk_cred_cond FOREIGN KEY (id_condominio) REFERENCES Condominios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Anti-reuso: o mesmo código abre uma vez por leitor.
CREATE TABLE IF NOT EXISTS Credenciais_Leituras (
  id INT NOT NULL AUTO_INCREMENT,
  id_credencial INT NOT NULL,
  id_device INT NOT NULL,
  contador INT NOT NULL,
  lido_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY un_credleit (id_credencial, id_device, contador),
  KEY idx_credleit_lido (lido_em),
  CONSTRAINT fk_credleit_cred FOREIGN KEY (id_credencial) REFERENCES Credenciais_Acesso(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
