-- Verificação de 2026-11-24-vagas-fk-set-null.sql. SÓ LEITURA.
-- Esperado: cada linha com ok = 1. Todo ok sai 0 ou 1, nunca NULL.

-- 1. Exatamente UMA FK em id_morador_beneficiario -> Moradores, fk_vaga_benef, SET NULL.
SELECT 'fk id_morador_beneficiario -> Moradores: so fk_vaga_benef, SET NULL' AS item,
  COALESCE(COUNT(*) = 1 AND MAX(rc.CONSTRAINT_NAME) = 'fk_vaga_benef' AND MAX(rc.DELETE_RULE) = 'SET NULL', 0) AS ok,
  GROUP_CONCAT(CONCAT(rc.CONSTRAINT_NAME, ':', rc.DELETE_RULE, '/', rc.UPDATE_RULE)) AS fks
  FROM information_schema.KEY_COLUMN_USAGE kcu
  JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
    ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
   AND rc.TABLE_NAME = kcu.TABLE_NAME
   AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
 WHERE kcu.TABLE_SCHEMA = DATABASE()
   AND kcu.TABLE_NAME = 'Vagas'
   AND kcu.COLUMN_NAME = 'id_morador_beneficiario'
   AND kcu.REFERENCED_TABLE_NAME = 'Moradores';

-- 2. Exatamente UMA FK em id_veiculo -> Veiculos, fk_vaga_veiculo, SET NULL.
SELECT 'fk id_veiculo -> Veiculos: so fk_vaga_veiculo, SET NULL' AS item,
  COALESCE(COUNT(*) = 1 AND MAX(rc.CONSTRAINT_NAME) = 'fk_vaga_veiculo' AND MAX(rc.DELETE_RULE) = 'SET NULL', 0) AS ok,
  GROUP_CONCAT(CONCAT(rc.CONSTRAINT_NAME, ':', rc.DELETE_RULE, '/', rc.UPDATE_RULE)) AS fks
  FROM information_schema.KEY_COLUMN_USAGE kcu
  JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
    ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
   AND rc.TABLE_NAME = kcu.TABLE_NAME
   AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
 WHERE kcu.TABLE_SCHEMA = DATABASE()
   AND kcu.TABLE_NAME = 'Vagas'
   AND kcu.COLUMN_NAME = 'id_veiculo'
   AND kcu.REFERENCED_TABLE_NAME = 'Veiculos';

-- 3. As demais FKs de Vagas não mudaram (informativo: titular/apto/cond em
-- CASCADE; visitante/visita como estavam).
SELECT CONSTRAINT_NAME, DELETE_RULE, UPDATE_RULE
  FROM information_schema.REFERENTIAL_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'Vagas'
 ORDER BY CONSTRAINT_NAME;
