-- Verificação de 2026-11-28-portaria-autonoma.sql. Esperado: todas as linhas com status = 'OK'.
-- Uma linha por coluna, tabela, índice e FK criados pelo script.
SELECT 'Condominios.central_contratada' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Condominios' AND COLUMN_NAME = 'central_contratada') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Condominios.ia_portao_ativa' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Condominios' AND COLUMN_NAME = 'ia_portao_ativa') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Condominios.instrucao_entregas' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Condominios' AND COLUMN_NAME = 'instrucao_entregas') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Condominios.interfone_numero_portaria' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Condominios' AND COLUMN_NAME = 'interfone_numero_portaria') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Interfone_Chamadas.id_operador_central' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Chamadas' AND COLUMN_NAME = 'id_operador_central') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Interfone_Chamadas.ia_resumo' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Chamadas' AND COLUMN_NAME = 'ia_resumo') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Interfone_Chamadas.ia_transcricao' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Chamadas' AND COLUMN_NAME = 'ia_transcricao') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Interfone_Chamadas.destino' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Chamadas' AND COLUMN_NAME = 'destino'
      AND DATA_TYPE = 'varchar' AND CHARACTER_MAXIMUM_LENGTH = 8 AND IS_NULLABLE = 'YES') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'tabela Portaria_Agenda',
  IF((SELECT COUNT(*) FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Portaria_Agenda') = 1, 'OK', 'FALTA')
UNION ALL
SELECT 'tabela Central_Operadores',
  IF((SELECT COUNT(*) FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Central_Operadores') = 1, 'OK', 'FALTA')
UNION ALL
SELECT 'tabela Interfone_Pedidos',
  IF((SELECT COUNT(*) FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Pedidos') = 1, 'OK', 'FALTA')
UNION ALL
SELECT 'Portaria_Agenda.id_condominio' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Portaria_Agenda' AND COLUMN_NAME = 'id_condominio') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Portaria_Agenda.dia_semana' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Portaria_Agenda' AND COLUMN_NAME = 'dia_semana') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Portaria_Agenda.inicio' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Portaria_Agenda' AND COLUMN_NAME = 'inicio') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Portaria_Agenda.fim' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Portaria_Agenda' AND COLUMN_NAME = 'fim') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Portaria_Agenda.destino' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Portaria_Agenda' AND COLUMN_NAME = 'destino') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Central_Operadores.nome' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Central_Operadores' AND COLUMN_NAME = 'nome') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Central_Operadores.email' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Central_Operadores' AND COLUMN_NAME = 'email') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Central_Operadores.senha_hash' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Central_Operadores' AND COLUMN_NAME = 'senha_hash') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Central_Operadores.trocar_senha' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Central_Operadores' AND COLUMN_NAME = 'trocar_senha') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Central_Operadores.ativo' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Central_Operadores' AND COLUMN_NAME = 'ativo') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Central_Operadores.cred' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Central_Operadores' AND COLUMN_NAME = 'cred') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Central_Operadores.ultimo_acesso' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Central_Operadores' AND COLUMN_NAME = 'ultimo_acesso') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Interfone_Pedidos.id_chamada' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Pedidos' AND COLUMN_NAME = 'id_chamada') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Interfone_Pedidos.id_condominio' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Pedidos' AND COLUMN_NAME = 'id_condominio') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Interfone_Pedidos.id_apartamento' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Pedidos' AND COLUMN_NAME = 'id_apartamento') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Interfone_Pedidos.nome_falado' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Pedidos' AND COLUMN_NAME = 'nome_falado') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Interfone_Pedidos.motivo' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Pedidos' AND COLUMN_NAME = 'motivo') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Interfone_Pedidos.tipo' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Pedidos' AND COLUMN_NAME = 'tipo') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Interfone_Pedidos.origem' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Pedidos' AND COLUMN_NAME = 'origem') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Interfone_Pedidos.foto' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Pedidos' AND COLUMN_NAME = 'foto') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Interfone_Pedidos.estado' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Pedidos' AND COLUMN_NAME = 'estado') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Interfone_Pedidos.mensagem' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Pedidos' AND COLUMN_NAME = 'mensagem') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Interfone_Pedidos.respondido_por_id' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Pedidos' AND COLUMN_NAME = 'respondido_por_id') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Interfone_Pedidos.respondido_por_nome' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Pedidos' AND COLUMN_NAME = 'respondido_por_nome') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Interfone_Pedidos.respondido_em' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Pedidos' AND COLUMN_NAME = 'respondido_em') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Portaria_Agenda.idx_pag_cond_dia',
  IF((SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Portaria_Agenda' AND INDEX_NAME = 'idx_pag_cond_dia') >= 1, 'OK', 'FALTA')
UNION ALL
SELECT 'Central_Operadores.idx_cop_email',
  IF((SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Central_Operadores' AND INDEX_NAME = 'idx_cop_email') >= 1, 'OK', 'FALTA')
UNION ALL
SELECT 'Interfone_Pedidos.idx_ipd_chamada',
  IF((SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Pedidos' AND INDEX_NAME = 'idx_ipd_chamada') >= 1, 'OK', 'FALTA')
UNION ALL
SELECT 'Interfone_Pedidos.idx_ipd_apto_created',
  IF((SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Pedidos' AND INDEX_NAME = 'idx_ipd_apto_created') >= 1, 'OK', 'FALTA')
UNION ALL
SELECT 'Interfone_Pedidos.idx_ipd_cond',
  IF((SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Pedidos' AND INDEX_NAME = 'idx_ipd_cond') >= 1, 'OK', 'FALTA')
UNION ALL
SELECT 'Portaria_Agenda.fk_pag_cond (ON DELETE CASCADE)',
  IF((SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'Portaria_Agenda'
      AND CONSTRAINT_NAME = 'fk_pag_cond' AND DELETE_RULE = 'CASCADE') = 1, 'OK', 'FALTA')
UNION ALL
SELECT 'Interfone_Pedidos.fk_ipd_chamada (ON DELETE CASCADE)',
  IF((SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Pedidos'
      AND CONSTRAINT_NAME = 'fk_ipd_chamada' AND DELETE_RULE = 'CASCADE') = 1, 'OK', 'FALTA')
UNION ALL
SELECT 'Interfone_Pedidos.fk_ipd_cond (ON DELETE CASCADE)',
  IF((SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Pedidos'
      AND CONSTRAINT_NAME = 'fk_ipd_cond' AND DELETE_RULE = 'CASCADE') = 1, 'OK', 'FALTA')
UNION ALL
SELECT 'Interfone_Pedidos.fk_ipd_apto (ON DELETE CASCADE)',
  IF((SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Pedidos'
      AND CONSTRAINT_NAME = 'fk_ipd_apto' AND DELETE_RULE = 'CASCADE') = 1, 'OK', 'FALTA');
