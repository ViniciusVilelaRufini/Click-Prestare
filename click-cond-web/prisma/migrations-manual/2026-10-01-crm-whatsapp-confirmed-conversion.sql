-- Um marcador durável por conversa impede que webhooks simultâneos contem o mesmo lead duas vezes.
ALTER TABLE crm_whatsapp_conversas
  ADD COLUMN conversao_lead_id INT NULL,
  ADD INDEX idx_crm_wa_conversas_conversao_lead (conversao_lead_id);
