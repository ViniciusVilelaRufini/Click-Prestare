CREATE TABLE crm_whatsapp_conversas (
  id INT NOT NULL AUTO_INCREMENT,
  wa_id VARCHAR(20) NOT NULL,
  nome_perfil VARCHAR(120) NULL,
  lead_id INT NULL,
  ultima_msg_em DATETIME NOT NULL,
  ultima_do_cliente_em DATETIME NULL,
  nao_lidas INT NOT NULL DEFAULT 0,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_wa_conversas_wa_id (wa_id),
  KEY idx_crm_wa_conversas_ultima (ultima_msg_em),
  CONSTRAINT fk_crm_wa_conversas_lead FOREIGN KEY (lead_id) REFERENCES crm_leads (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE crm_whatsapp_mensagens (
  id INT NOT NULL AUTO_INCREMENT,
  conversa_id INT NOT NULL,
  wamid VARCHAR(191) NOT NULL,
  direcao VARCHAR(10) NOT NULL,
  tipo VARCHAR(20) NOT NULL,
  texto TEXT NOT NULL,
  status VARCHAR(12) NOT NULL,
  erro VARCHAR(500) NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_wa_mensagens_wamid (wamid),
  KEY idx_crm_wa_mensagens_conversa (conversa_id, criado_em),
  CONSTRAINT fk_crm_wa_mensagens_conversa FOREIGN KEY (conversa_id) REFERENCES crm_whatsapp_conversas (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
