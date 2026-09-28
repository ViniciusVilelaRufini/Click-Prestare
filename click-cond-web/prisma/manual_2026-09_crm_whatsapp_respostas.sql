CREATE TABLE crm_whatsapp_respostas (
  id INT NOT NULL AUTO_INCREMENT,
  atalho VARCHAR(40) NOT NULL,
  titulo VARCHAR(80) NOT NULL,
  texto TEXT NOT NULL,
  ordem INT NOT NULL DEFAULT 0,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_wa_respostas_atalho (atalho)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO crm_whatsapp_respostas (atalho, titulo, texto, ordem) VALUES
('apresentacao', 'Apresentação', 'Olá! Aqui é a Prestare Gestão. Trabalhamos com controle de acesso para condomínios: reconhecimento facial, portaria digital e remota, e app para síndico e moradores. Como posso te ajudar?', 1),
('dados', 'Pedir dados do condomínio', 'Para montar seu orçamento, me passa por favor: nome do condomínio, cidade, número de unidades e quantas entradas (portões/portarias) ele tem?', 2),
('proposta', 'Envio de proposta', 'Preparei a proposta para o seu condomínio. Posso te explicar os detalhes por aqui ou marcar uma conversa rápida, o que fica melhor para você?', 3),
('obrigado', 'Agradecimento', 'Obrigado pelo contato! Qualquer dúvida é só chamar por aqui. Tenha um ótimo dia!', 4);
