-- Verificação de 2026-11-27-interfone.sql. Esperado: todas as linhas com status = 'OK'.
-- Uma linha por coluna, chave, tabela, índice e FK criados pelo script.
SELECT 'Condominios.interfone_contratado' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Condominios' AND COLUMN_NAME = 'interfone_contratado') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Condominios.interfone_ativo' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Condominios' AND COLUMN_NAME = 'interfone_ativo') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Condominios.interfone_toque_apto_s' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Condominios' AND COLUMN_NAME = 'interfone_toque_apto_s') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Condominios.interfone_transferir' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Condominios' AND COLUMN_NAME = 'interfone_transferir') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Condominios.interfone_toque_portaria_s' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Condominios' AND COLUMN_NAME = 'interfone_toque_portaria_s') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Apartamentos.interfone_ramal' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Apartamentos' AND COLUMN_NAME = 'interfone_ramal') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Facial_Devices.interfone_habilitado' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Facial_Devices' AND COLUMN_NAME = 'interfone_habilitado') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Facial_Devices.interfone_senha' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Facial_Devices' AND COLUMN_NAME = 'interfone_senha') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Facial_Devices.interfone_blocos' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Facial_Devices' AND COLUMN_NAME = 'interfone_blocos') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Facial_Devices.interfone_dtmf' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Facial_Devices' AND COLUMN_NAME = 'interfone_dtmf') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Facial_Devices.interfone_registrado' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Facial_Devices' AND COLUMN_NAME = 'interfone_registrado') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Facial_Devices.interfone_registrado_em' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Facial_Devices' AND COLUMN_NAME = 'interfone_registrado_em') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Users_Devices.voip_token' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Users_Devices' AND COLUMN_NAME = 'voip_token') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Users_Devices.interfone_versao' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Users_Devices' AND COLUMN_NAME = 'interfone_versao') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Users.interfone_receber' AS item,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Users' AND COLUMN_NAME = 'interfone_receber') = 1, 'OK', 'FALTA') AS status
UNION ALL
SELECT 'Apartamentos.un_apto_ramal (unica, 2 colunas)',
  IF((SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Apartamentos' AND INDEX_NAME = 'un_apto_ramal' AND NON_UNIQUE = 0) = 2, 'OK', 'FALTA')
UNION ALL
SELECT 'Interfone_Monitores (7 colunas)',
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Monitores') = 7, 'OK', 'FALTA')
UNION ALL
SELECT 'Interfone_Chamadas (23 colunas)',
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Chamadas') = 23, 'OK', 'FALTA')
UNION ALL
SELECT 'Interfone_Chamadas.idx_ifc_cond_created',
  IF((SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Chamadas' AND INDEX_NAME = 'idx_ifc_cond_created') > 0, 'OK', 'FALTA')
UNION ALL
SELECT 'Interfone_Chamadas.idx_ifc_apto_created',
  IF((SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Chamadas' AND INDEX_NAME = 'idx_ifc_apto_created') > 0, 'OK', 'FALTA')
UNION ALL
SELECT 'Interfone_Chamadas.idx_ifc_facial_created',
  IF((SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Chamadas' AND INDEX_NAME = 'idx_ifc_facial_created') > 0, 'OK', 'FALTA')
UNION ALL
SELECT 'Interfone_Chamadas.idx_ifc_estado_created',
  IF((SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Chamadas' AND INDEX_NAME = 'idx_ifc_estado_created') > 0, 'OK', 'FALTA')
UNION ALL
SELECT 'Users_Devices.idx_ud_voip_token',
  IF((SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Users_Devices' AND INDEX_NAME = 'idx_ud_voip_token') > 0, 'OK', 'FALTA')
UNION ALL
SELECT 'Interfone_Chamadas.idx_ifc_user_origem',
  IF((SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Chamadas' AND INDEX_NAME = 'idx_ifc_user_origem') > 0, 'OK', 'FALTA')
UNION ALL
SELECT 'Interfone_Monitores.idx_ifm_cond',
  IF((SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Monitores' AND INDEX_NAME = 'idx_ifm_cond') > 0, 'OK', 'FALTA')
UNION ALL
SELECT 'Interfone_Monitores.idx_ifm_apto',
  IF((SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Monitores' AND INDEX_NAME = 'idx_ifm_apto') > 0, 'OK', 'FALTA')
UNION ALL
SELECT 'Interfone_Monitores.fk_ifm_cond (ON DELETE CASCADE)',
  IF((SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Monitores'
      AND CONSTRAINT_NAME = 'fk_ifm_cond' AND DELETE_RULE = 'CASCADE') = 1, 'OK', 'FALTA')
UNION ALL
SELECT 'Interfone_Monitores.fk_ifm_apto (ON DELETE CASCADE)',
  IF((SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Monitores'
      AND CONSTRAINT_NAME = 'fk_ifm_apto' AND DELETE_RULE = 'CASCADE') = 1, 'OK', 'FALTA')
UNION ALL
SELECT 'Interfone_Chamadas.fk_ifc_cond (ON DELETE CASCADE)',
  IF((SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Chamadas'
      AND CONSTRAINT_NAME = 'fk_ifc_cond' AND DELETE_RULE = 'CASCADE') = 1, 'OK', 'FALTA')
UNION ALL
SELECT 'Interfone_Chamadas.fk_ifc_facial (ON DELETE SET NULL)',
  IF((SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Chamadas'
      AND CONSTRAINT_NAME = 'fk_ifc_facial' AND DELETE_RULE = 'SET NULL') = 1, 'OK', 'FALTA')
UNION ALL
SELECT 'Interfone_Chamadas.fk_ifc_apto (ON DELETE SET NULL)',
  IF((SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Chamadas'
      AND CONSTRAINT_NAME = 'fk_ifc_apto' AND DELETE_RULE = 'SET NULL') = 1, 'OK', 'FALTA')
UNION ALL
SELECT 'Interfone_Chamadas.fk_ifc_user_origem (ON DELETE SET NULL)',
  IF((SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'Interfone_Chamadas'
      AND CONSTRAINT_NAME = 'fk_ifc_user_origem' AND DELETE_RULE = 'SET NULL') = 1, 'OK', 'FALTA');
