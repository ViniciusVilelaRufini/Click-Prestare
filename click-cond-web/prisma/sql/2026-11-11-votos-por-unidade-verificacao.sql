-- Verificação de 2026-11-11-votos-por-unidade.sql. SÓ LEITURA.
-- Esperado: cada linha com ok = 1 (e as contagens do fim só informativas).
-- Todo ok sai 0 ou 1, nunca NULL (COUNT, ou COALESCE onde há agregação de texto).

-- 1. Coluna id_apto: INT, anulável, sem default.
SELECT 'coluna id_apto' AS item,
       COUNT(*) = 1 AS ok,
       MAX(COLUMN_TYPE) AS tipo, MAX(IS_NULLABLE) AS anulavel, MAX(COLUMN_DEFAULT) AS padrao
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Votacoes_Usuarios' AND COLUMN_NAME = 'id_apto'
   AND DATA_TYPE = 'int' AND IS_NULLABLE = 'YES';

-- 2. Índice idx_vu_apto_opcao = (id_apto, id_opcao), nessa ordem, não único.
SELECT 'indice idx_vu_apto_opcao' AS item,
       -- Sem o índice o GROUP_CONCAT é NULL: COALESCE para o ok sair 0, não NULL.
       COALESCE(GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'id_apto,id_opcao' AND MAX(NON_UNIQUE) = 1, 0) AS ok,
       GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS colunas
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Votacoes_Usuarios' AND INDEX_NAME = 'idx_vu_apto_opcao';

-- 3. FK fk_vu_apto -> Apartamentos(id), ON DELETE SET NULL.
SELECT 'fk fk_vu_apto' AS item,
       COUNT(*) = 1 AS ok,
       MAX(rc.REFERENCED_TABLE_NAME) AS referencia, MAX(rc.DELETE_RULE) AS ao_apagar, MAX(rc.UPDATE_RULE) AS ao_atualizar
  FROM information_schema.REFERENTIAL_CONSTRAINTS rc
 WHERE rc.CONSTRAINT_SCHEMA = DATABASE() AND rc.TABLE_NAME = 'Votacoes_Usuarios'
   AND rc.CONSTRAINT_NAME = 'fk_vu_apto' AND rc.REFERENCED_TABLE_NAME = 'Apartamentos'
   AND rc.DELETE_RULE = 'SET NULL';

-- 4. As FKs antigas continuam (opção e usuário em cascata, como antes).
SELECT 'fks antigas' AS item,
       COUNT(*) = 2 AS ok,
       GROUP_CONCAT(CONCAT(CONSTRAINT_NAME, ':', DELETE_RULE) ORDER BY CONSTRAINT_NAME) AS fks
  FROM information_schema.REFERENTIAL_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'Votacoes_Usuarios'
   AND CONSTRAINT_NAME IN ('fk_vu_op', 'fk_vu_user');

-- 5. Nenhum voto com unidade de OUTRO condomínio que não o da votação
--    (a API recusa; 0 logo após a migração, porque tudo é nulo).
SELECT 'unidade de outro condominio' AS item,
       COUNT(*) = 0 AS ok, COUNT(*) AS votos
  FROM Votacoes_Usuarios vu
  JOIN Votacoes_Opcoes vo ON vo.id = vu.id_opcao
  JOIN Votacoes v ON v.id = vo.id_votacao
  JOIN Apartamentos a ON a.id = vu.id_apto
 WHERE a.id_condominio <> v.id_condominio;

-- 6. Informativo: votos antigos (nulos) x votos por unidade.
SELECT SUM(id_apto IS NULL) AS votos_sem_unidade, SUM(id_apto IS NOT NULL) AS votos_com_unidade, COUNT(*) AS total
  FROM Votacoes_Usuarios;

-- 7. Informativo: unidades com mais de uma linha na mesma votação (corrida
--    residual; a apuração conta só a mais recente).
SELECT vo.id_votacao, vu.id_apto, COUNT(*) AS linhas
  FROM Votacoes_Usuarios vu
  JOIN Votacoes_Opcoes vo ON vo.id = vu.id_opcao
 WHERE vu.id_apto IS NOT NULL
 GROUP BY vo.id_votacao, vu.id_apto
HAVING COUNT(*) > 1;
