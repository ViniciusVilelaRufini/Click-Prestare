-- Apartamentos_Users (D4, varredura 24/11): um vínculo por (unidade, usuário).
-- Chave única uq_au_apto_user (id_apto, id_user).
--
-- Por quê: sem a chave, duas chamadas ao mesmo tempo (ou um fluxo que não
-- conferia antes) gravavam o mesmo usuário duas vezes na mesma unidade, junto
-- com duas linhas de Moradores. Remover o morador tirava um vínculo e deixava a
-- outra linha de Moradores órfã, com foto, tag e QR ainda valendo. Com a chave,
-- a segunda gravação recebe "já está vinculado a este apartamento" (a API trata
-- o P2002 nos creates).
--
-- APLICAR ANTES DO DEPLOY. Seguro com o código antigo no ar: o código antigo já
-- confere o vínculo repetido antes de criar; a chave só barra a corrida (o
-- código antigo devolve erro genérico nesse caso, em vez de duplicar).
--
-- DUPLICATAS JÁ EXISTENTES NÃO SÃO APAGADAS AQUI. Antes de aplicar, rode
-- 2026-11-24-apartamentos-users-unico-verificacao.sql: o item 1 lista cada par
-- (id_apto, id_user) repetido com os ids dos vínculos e as linhas de Moradores
-- do usuário na unidade. Se houver alguma, o passo 2 deste script NÃO roda
-- (devolve 'ha duplicatas') e nada muda.
--
-- Deduplicação segura (à mão, um par por vez):
--   a. Vínculo repetido: mantenha o de menor id e apague os outros pelo id que
--      a verificação mostrou (Apartamentos_Users só liga usuário e unidade; não
--      guarda foto, tag nem QR):
--        -- DELETE FROM `Apartamentos_Users` WHERE id IN (<ids repetidos>);
--      (comentado de propósito: confira os ids antes; tipo e vencimento do
--      vínculo mantido passam a valer para a unidade).
--   b. Se a verificação mostrar DUAS ou mais linhas de Moradores do usuário na
--      unidade, a sobrando (sem foto/tag/QR, ou a mais nova) sai PELO CONSOLE,
--      nunca por SQL: remover pela tela tira o rosto dos terminais, revoga o
--      passe da carteira e a tag. Atenção: o remover do console apaga TODOS os
--      vínculos do usuário naquele condomínio; depois dele, abra a linha que
--      ficou em Editar morador e salve a unidade dela de novo (recria o
--      vínculo) e confira na verificação.
--   c. Rode a verificação de novo (item 1 sem linhas) e então este script.
--
-- Idempotente: confere o information_schema e vira no-op se a chave já existe.
-- Rodar numa única sessão (usa @sql). MySQL 8.4. lock_wait_timeout de 10 s.

SET SESSION lock_wait_timeout = 10;

-- 1. Informativo: duplicatas que impediriam a chave (esperado: nenhuma linha).
SELECT id_apto, id_user, COUNT(*) AS n, GROUP_CONCAT(id ORDER BY id) AS ids
  FROM `Apartamentos_Users`
 GROUP BY id_apto, id_user
HAVING COUNT(*) > 1;

-- 2. Chave única, só se não existe e não há duplicatas.
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Apartamentos_Users' AND INDEX_NAME = 'uq_au_apto_user') > 0,
  'SELECT ''uq_au_apto_user: ja existe'' AS passo_2',
  IF(
    (SELECT COUNT(*) FROM (
       SELECT 1 FROM `Apartamentos_Users` GROUP BY id_apto, id_user HAVING COUNT(*) > 1) d) > 0,
    'SELECT ''uq_au_apto_user: NAO criada, ha duplicatas (ver a verificacao e o topo deste arquivo)'' AS passo_2',
    'ALTER TABLE `Apartamentos_Users` ADD UNIQUE KEY `uq_au_apto_user` (`id_apto`, `id_user`)'));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
