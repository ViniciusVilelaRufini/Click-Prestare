-- Dados opcionais do entregador informados pelo morador no aviso inicial.
-- Migração manual para MySQL 8/Railway; executar antes do deploy que recebe
-- `nome_entregador` e `telefone_entregador` em POST /delivery.

ALTER TABLE delivery_atendimentos
  ADD COLUMN nome_entregador VARCHAR(255) NULL AFTER observacao_morador,
  ADD COLUMN telefone_entregador VARCHAR(50) NULL AFTER nome_entregador;
