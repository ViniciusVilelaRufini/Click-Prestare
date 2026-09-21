-- Versiona os offsets de AUTO_INCREMENT de `pessoas` e `visitas`, que ate
-- agora so existiam em producao (aplicados manualmente) e numa constante do
-- script de wipe (OFFSET_AUTO_INCREMENT em scripts/migration/wipe-test-data.mjs).
--
-- Por que existem: varias leituras do caminho migrado (feed de acessos,
-- painel de fotos recentes do dashboard, relatorios) recebem um id vindo de
-- Acessos_Facial.id_pessoa sem saber se ele e' um Pessoas.id ou um Visitas.id
-- (a coluna carrega os dois, dependendo do tipo de evento). A mitigacao e'
-- consultar as duas tabelas e ficar com a que responder — o que so funciona
-- sem ambiguidade porque os dois espacos de id nao se sobrepoem.
--
-- Sem este arquivo, qualquer banco criado do zero (dev, staging, um clone
-- para teste) nasce com as duas tabelas comecando em 1 — colidindo de
-- frente com o legado (Visitantes tambem comeca em 1) e reabrindo a classe
-- de bug que essa separacao existe para evitar.
--
-- Idempotente: reaplicar sobre uma tabela ja nesses valores (ou com id maior
-- gravado) e' inofensivo — o MySQL nunca abaixa o proximo AUTO_INCREMENT
-- abaixo do maior id ja usado.

ALTER TABLE `pessoas` AUTO_INCREMENT = 2000000;
ALTER TABLE `visitas` AUTO_INCREMENT = 1000000;
