CREATE TABLE IF NOT EXISTS crm_leads (
  id INT NOT NULL AUTO_INCREMENT,
  nome VARCHAR(120) NOT NULL,
  condominio VARCHAR(160) NOT NULL,
  unidades VARCHAR(60) NOT NULL,
  whatsapp VARCHAR(20) NOT NULL,
  origem ENUM('google','openai','instagram','organico') NOT NULL,
  gclid VARCHAR(255) NULL,
  oppref VARCHAR(255) NULL,
  utm_source VARCHAR(120) NULL,
  utm_medium VARCHAR(120) NULL,
  utm_campaign VARCHAR(120) NULL,
  pagina VARCHAR(255) NULL,
  status ENUM('novo','em_contato','proposta','fechado','perdido') NOT NULL DEFAULT 'novo',
  observacao TEXT NULL,
  status_em DATETIME NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_crm_leads_criado (criado_em),
  INDEX idx_crm_leads_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_anuncios_diario (
  id INT NOT NULL AUTO_INCREMENT,
  plataforma ENUM('google','openai') NOT NULL,
  campanha_id VARCHAR(64) NOT NULL,
  campanha_nome VARCHAR(200) NOT NULL,
  dia DATE NOT NULL,
  impressoes INT NOT NULL DEFAULT 0,
  cliques INT NOT NULL DEFAULT 0,
  gasto DECIMAL(12,2) NOT NULL DEFAULT 0,
  conversoes DECIMAL(10,2) NOT NULL DEFAULT 0,
  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_anuncios_dia (plataforma, campanha_id, dia)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
