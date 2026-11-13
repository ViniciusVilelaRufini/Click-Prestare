-- =============================================================================================
-- PROPOSTA — NÃO APLICADO. Não rodar sem decisão do dono (auditoria run-3, R7).
-- Objetivo: excluir a própria conta (POST /users/delete-account) não apagar votos de assembleia
-- nem respostas em ocorrências do condomínio. Hoje as duas colunas são NOT NULL com ON DELETE CASCADE.
-- Depois de aplicar: schema.prisma passa a `id_user Int?` (Votacoes_Usuarios) e `id_usuario Int?`
-- (OcorrenciaMensagens) com `onDelete: SetNull`; revisar a apuração dos votos antigos sem id_apto
-- (contam pela unidade da conta — sem conta, deixam de contar) e quem exibe o autor da mensagem.
-- =============================================================================================

-- 0. Conferir o estado atual (somente leitura) e o ON UPDATE de cada FK antes de recriar.
SELECT CONSTRAINT_NAME, UPDATE_RULE, DELETE_RULE
  FROM information_schema.REFERENTIAL_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA = DATABASE()
   AND CONSTRAINT_NAME IN ('fk_fin_user', 'fk_vu_user', 'fk_msg_user');
-- SHOW CREATE TABLE Votacoes_Usuarios;  SHOW CREATE TABLE OcorrenciaMensagens;

-- 1. Votos: a unidade (id_apto) continua no voto; a conta vira NULL.
ALTER TABLE Votacoes_Usuarios DROP FOREIGN KEY fk_vu_user;
ALTER TABLE Votacoes_Usuarios MODIFY id_user INT NULL;
ALTER TABLE Votacoes_Usuarios
  ADD CONSTRAINT fk_vu_user FOREIGN KEY (id_user) REFERENCES Users(id) ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. Mensagens de ocorrência: o texto fica na thread do condomínio; o autor vira NULL.
ALTER TABLE OcorrenciaMensagens DROP FOREIGN KEY fk_msg_user;
ALTER TABLE OcorrenciaMensagens MODIFY id_usuario INT NULL;
ALTER TABLE OcorrenciaMensagens
  ADD CONSTRAINT fk_msg_user FOREIGN KEY (id_usuario) REFERENCES Users(id) ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. (Opcional, defesa em profundidade) Financeiro: o código já desvincula antes do DELETE.
-- ALTER TABLE Financeiro DROP FOREIGN KEY fk_fin_user;
-- ALTER TABLE Financeiro
--   ADD CONSTRAINT fk_fin_user FOREIGN KEY (id_usuario) REFERENCES Users(id) ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. Verificação: as três devem sair com DELETE_RULE = 'SET NULL' (a 3 só se aplicada).
SELECT CONSTRAINT_NAME, DELETE_RULE
  FROM information_schema.REFERENTIAL_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA = DATABASE()
   AND CONSTRAINT_NAME IN ('fk_fin_user', 'fk_vu_user', 'fk_msg_user');
