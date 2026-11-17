-- Verificação de 2026-11-17-onboarding.sql. SÓ LEITURA.
-- Esperado: cada linha com ok = 1 (o item informativo do fim não tem ok).
-- Todo ok sai 0 ou 1, nunca NULL.

-- 1. Condominios.aprovado_em existe, DATETIME anulável.
SELECT 'Condominios.aprovado_em DATETIME NULL' AS item,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Condominios' AND COLUMN_NAME = 'aprovado_em'
      AND DATA_TYPE = 'datetime' AND IS_NULLABLE = 'YES') AS ok;

-- 2. Nenhum condomínio ativo ficou sem aprovado_em.
SELECT 'ativo = 1 sem aprovado_em = 0' AS item,
  (SELECT COUNT(*) FROM Condominios WHERE ativo = 1 AND aprovado_em IS NULL) = 0 AS ok;

-- 3. Chave única (id_user, id_condominio) em Sindicos_Condominios.
SELECT 'indice unico uq_sindico_condominio (id_user, id_condominio)' AS item,
  COALESCE(GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'id_user,id_condominio', 0) AS ok
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Sindicos_Condominios'
   AND INDEX_NAME = 'uq_sindico_condominio' AND NON_UNIQUE = 0;

-- 4. Zero duplicatas.
SELECT 'Sindicos_Condominios sem duplicatas' AS item,
  (SELECT COUNT(*) FROM (
     SELECT id_user, id_condominio FROM Sindicos_Condominios
      GROUP BY id_user, id_condominio HAVING COUNT(*) > 1) d) = 0 AS ok;

-- 5. Informativo: condomínios "em análise" (ativo = 0 sem aprovado_em). Se algum
-- foi desativado no CRM antes desta migração, preencher aprovado_em a mão para
-- ele aparecer como suspenso/churn.
SELECT id, nome, created_at FROM Condominios WHERE ativo = 0 AND aprovado_em IS NULL;
