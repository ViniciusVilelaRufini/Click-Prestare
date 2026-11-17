-- Verificação (SOMENTE LEITURA) — rodar no RDS via CloudShell + tunel.sh.
-- Antes desta correção, o CRM gravava plano/mensalidade da Prestare nas colunas de cobrança
-- dos moradores. Estas consultas listam o que pode ter sido contaminado. Nenhum UPDATE/DELETE:
-- a limpeza (se houver dado real) é decidida a partir do resultado.

-- 1) Condomínios com plano da Prestare na categoria padrão ou recorrência ligada pelo CRM.
SELECT id, nome, categoria_padrao, valor_condominio, recorrencia_ativa, cobranca_auto_whats
FROM Condominios
WHERE categoria_padrao IN ('Essencial', 'Profissional', 'Elite', 'Sem plano')
   OR recorrencia_ativa = 1
ORDER BY id;

-- 2) Lançamentos do Financeiro que usam esses nomes de plano como categoria (contagem por condomínio).
SELECT id_condominio, categoria, COUNT(*) AS lancamentos
FROM Financeiro
WHERE categoria IN ('Essencial', 'Profissional', 'Elite', 'Sem plano')
GROUP BY id_condominio, categoria
ORDER BY id_condominio, categoria;
