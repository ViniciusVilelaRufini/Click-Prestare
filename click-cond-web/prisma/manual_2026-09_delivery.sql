-- Delivery: avisos de entrega, entregadores reutilizáveis e trilha de eventos.
-- Migração manual para MySQL 8/Railway. Execute antes do deploy da API.

CREATE TABLE IF NOT EXISTS delivery_entregadores (
  id INT NOT NULL AUTO_INCREMENT,
  id_condominio INT NOT NULL,
  nome VARCHAR(255) NOT NULL,
  telefone VARCHAR(50) NULL,
  documento VARCHAR(50) NULL,
  plataforma VARCHAR(255) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ATIVO',
  motivo_bloqueio TEXT NULL,
  foto VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_delivery_entregador_cond_status (id_condominio, status),
  CONSTRAINT fk_delivery_entregador_cond FOREIGN KEY (id_condominio) REFERENCES Condominios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS delivery_veiculos (
  id INT NOT NULL AUTO_INCREMENT,
  id_condominio INT NOT NULL,
  id_entregador INT NOT NULL,
  tipo VARCHAR(50) NULL,
  placa VARCHAR(20) NULL,
  modelo VARCHAR(100) NULL,
  cor VARCHAR(50) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY un_delivery_veiculo_cond_placa (id_condominio, placa),
  KEY fk_delivery_veiculo_entregador (id_entregador),
  CONSTRAINT fk_delivery_veiculo_cond FOREIGN KEY (id_condominio) REFERENCES Condominios(id) ON DELETE CASCADE,
  CONSTRAINT fk_delivery_veiculo_entregador FOREIGN KEY (id_entregador) REFERENCES delivery_entregadores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS delivery_atendimentos (
  id INT NOT NULL AUTO_INCREMENT,
  id_condominio INT NOT NULL,
  id_apartamento INT NOT NULL,
  id_morador_user INT NOT NULL,
  id_entregador INT NULL,
  estabelecimento VARCHAR(255) NULL,
  previsao_em DATETIME NULL,
  observacao_morador TEXT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'AGENDADA',
  modo_entrega VARCHAR(20) NOT NULL DEFAULT 'UNIDADE',
  chegou_em DATETIME NULL,
  autorizado_em DATETIME NULL,
  concluido_em DATETIME NULL,
  cancelado_em DATETIME NULL,
  recusado_em DATETIME NULL,
  motivo TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_delivery_atendimento_cond_status_criado (id_condominio, status, created_at),
  KEY fk_delivery_atendimento_apto (id_apartamento),
  KEY fk_delivery_atendimento_morador (id_morador_user),
  KEY fk_delivery_atendimento_entregador (id_entregador),
  CONSTRAINT fk_delivery_atendimento_cond FOREIGN KEY (id_condominio) REFERENCES Condominios(id) ON DELETE CASCADE,
  CONSTRAINT fk_delivery_atendimento_apto FOREIGN KEY (id_apartamento) REFERENCES Apartamentos(id) ON DELETE RESTRICT,
  CONSTRAINT fk_delivery_atendimento_morador FOREIGN KEY (id_morador_user) REFERENCES Users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_delivery_atendimento_entregador FOREIGN KEY (id_entregador) REFERENCES delivery_entregadores(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS delivery_eventos (
  id INT NOT NULL AUTO_INCREMENT,
  id_atendimento INT NOT NULL,
  status_anterior VARCHAR(30) NULL,
  status_novo VARCHAR(30) NOT NULL,
  id_usuario_autor INT NULL,
  autor_nome VARCHAR(255) NULL,
  mensagem TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_delivery_evento_atendimento_criado (id_atendimento, created_at),
  KEY idx_delivery_evento_autor (id_usuario_autor),
  CONSTRAINT fk_delivery_evento_atendimento FOREIGN KEY (id_atendimento) REFERENCES delivery_atendimentos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
