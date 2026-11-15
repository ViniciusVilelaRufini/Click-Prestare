-- Verificação de 2026-11-15-guarita.sql. SÓ LEITURA.
-- Esperado: cada linha com ok = 1 (as contagens do fim são só informativas).
-- Todo ok sai 0 ou 1, nunca NULL.

-- 1. Tags: colunas novas, todas anuláveis.
SELECT 'Tags.id_device INT NULL' AS item,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Tags' AND COLUMN_NAME = 'id_device'
      AND DATA_TYPE = 'int' AND IS_NULLABLE = 'YES') AS ok;
SELECT 'Tags.id_apto INT NULL' AS item,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Tags' AND COLUMN_NAME = 'id_apto'
      AND DATA_TYPE = 'int' AND IS_NULLABLE = 'YES') AS ok;
SELECT 'Tags.guarita_tipo TINYINT NULL' AS item,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Tags' AND COLUMN_NAME = 'guarita_tipo'
      AND DATA_TYPE = 'tinyint' AND IS_NULLABLE = 'YES') AS ok;
SELECT 'Tags.guarita_serial VARCHAR(8) NULL' AS item,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Tags' AND COLUMN_NAME = 'guarita_serial'
      AND DATA_TYPE = 'varchar' AND CHARACTER_MAXIMUM_LENGTH = 8 AND IS_NULLABLE = 'YES') AS ok;
SELECT 'Tags.guarita_contador INT NULL' AS item,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Tags' AND COLUMN_NAME = 'guarita_contador'
      AND DATA_TYPE = 'int' AND IS_NULLABLE = 'YES') AS ok;
SELECT 'Tags.guarita_estado VARCHAR(24) NULL' AS item,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Tags' AND COLUMN_NAME = 'guarita_estado'
      AND DATA_TYPE = 'varchar' AND CHARACTER_MAXIMUM_LENGTH = 24 AND IS_NULLABLE = 'YES') AS ok;
SELECT 'Tags.guarita_erro VARCHAR(255) NULL' AS item,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Tags' AND COLUMN_NAME = 'guarita_erro'
      AND DATA_TYPE = 'varchar' AND CHARACTER_MAXIMUM_LENGTH = 255 AND IS_NULLABLE = 'YES') AS ok;
SELECT 'Tags.guarita_frame CHAR(78) NULL' AS item,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Tags' AND COLUMN_NAME = 'guarita_frame'
      AND DATA_TYPE = 'char' AND CHARACTER_MAXIMUM_LENGTH = 78 AND IS_NULLABLE = 'YES') AS ok;
SELECT 'Tags.guarita_em DATETIME NULL' AS item,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Tags' AND COLUMN_NAME = 'guarita_em'
      AND DATA_TYPE = 'datetime' AND IS_NULLABLE = 'YES') AS ok;

-- 2. Tags: índices.
SELECT 'indice idx_tag_guarita (id_device, guarita_tipo, guarita_serial)' AS item,
  COALESCE(GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'id_device,guarita_tipo,guarita_serial', 0) AS ok
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Tags' AND INDEX_NAME = 'idx_tag_guarita';
SELECT 'indice fk_tag_guarita_apto (id_apto)' AS item,
  COALESCE(GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'id_apto', 0) AS ok
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Tags' AND INDEX_NAME = 'fk_tag_guarita_apto';
-- O único de sempre continua (o código G<tipo>-<SERIAL> depende dele).
SELECT 'Tags un_tag_cond_codigo (id_condominio, codigo) continua' AS item,
  COALESCE(GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'id_condominio,codigo', 0) AS ok
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Tags' AND INDEX_NAME = 'un_tag_cond_codigo' AND NON_UNIQUE = 0;

-- 3. Tags: FKs SET NULL.
SELECT 'fk_tag_guarita_device -> Facial_Devices SET NULL' AS item,
  (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'Tags'
      AND CONSTRAINT_NAME = 'fk_tag_guarita_device' AND REFERENCED_TABLE_NAME = 'Facial_Devices'
      AND DELETE_RULE = 'SET NULL') AS ok;
SELECT 'fk_tag_guarita_apto -> Apartamentos SET NULL' AS item,
  (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'Tags'
      AND CONSTRAINT_NAME = 'fk_tag_guarita_apto' AND REFERENCED_TABLE_NAME = 'Apartamentos'
      AND DELETE_RULE = 'SET NULL') AS ok;

-- 4. Tabelas novas.
SELECT 'tabelas Guarita_* (6)' AS item,
  (SELECT COUNT(*) FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME IN ('Guarita_Operacoes', 'Guarita_Eventos', 'Guarita_Backups',
                         'Guarita_Portoes', 'Guarita_Alertas', 'Guarita_Importacoes')) = 6 AS ok;

SELECT 'Guarita_Operacoes: colunas' AS item,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Guarita_Operacoes'
      AND COLUMN_NAME IN ('id', 'id_condominio', 'id_device', 'id_tag', 'id_veiculo', 'tipo', 'frame_hex',
                          'estado', 'codigo', 'erro', 'criado_por', 'created_at', 'enviada_em', 'concluida_em')) = 14 AS ok;
SELECT 'Guarita_Operacoes.estado default pendente' AS item,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Guarita_Operacoes' AND COLUMN_NAME = 'estado'
      AND COLUMN_DEFAULT = 'pendente' AND IS_NULLABLE = 'NO') AS ok;
SELECT 'indice idx_gop_device_estado (id_device, estado, id)' AS item,
  COALESCE(GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'id_device,estado,id', 0) AS ok
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Guarita_Operacoes' AND INDEX_NAME = 'idx_gop_device_estado';

SELECT 'Guarita_Eventos: unico (id_device, chave)' AS item,
  COALESCE(GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'id_device,chave', 0) AS ok
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Guarita_Eventos' AND INDEX_NAME = 'un_gev_device_chave' AND NON_UNIQUE = 0;
SELECT 'Guarita_Eventos.chave CHAR(64), frame_hex CHAR(32)' AS item,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Guarita_Eventos'
      AND ((COLUMN_NAME = 'chave' AND CHARACTER_MAXIMUM_LENGTH = 64)
        OR (COLUMN_NAME = 'frame_hex' AND CHARACTER_MAXIMUM_LENGTH = 32))) = 2 AS ok;

SELECT 'Guarita_Backups.dados LONGTEXT' AS item,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Guarita_Backups' AND COLUMN_NAME = 'dados'
      AND DATA_TYPE = 'longtext') AS ok;

SELECT 'Guarita_Alertas: indice (id_condominio, visto_em, id)' AS item,
  COALESCE(GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'id_condominio,visto_em,id', 0) AS ok
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Guarita_Alertas' AND INDEX_NAME = 'idx_gal_cond_visto';

SELECT 'Guarita_Importacoes: unico (id_operacao, parte)' AS item,
  COALESCE(GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'id_operacao,parte', 0) AS ok
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Guarita_Importacoes' AND INDEX_NAME = 'un_gim_operacao_parte' AND NON_UNIQUE = 0;

-- 5. FKs das tabelas novas: 11, todas em cascata.
SELECT 'FKs das tabelas Guarita_* em CASCADE (11)' AS item,
  COUNT(*) = 11 AS ok,
  GROUP_CONCAT(CONCAT(TABLE_NAME, '.', CONSTRAINT_NAME, ':', DELETE_RULE) ORDER BY CONSTRAINT_NAME) AS fks
  FROM information_schema.REFERENTIAL_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA = DATABASE()
   AND TABLE_NAME IN ('Guarita_Operacoes', 'Guarita_Eventos', 'Guarita_Backups',
                      'Guarita_Portoes', 'Guarita_Alertas', 'Guarita_Importacoes')
   AND DELETE_RULE = 'CASCADE';

-- 6. Acessos_Facial não mudou: FKs Restrict de sempre.
SELECT 'Acessos_Facial: fk_acfac_device e fk_acfac_cond continuam RESTRICT' AS item,
  COUNT(*) = 2 AS ok
  FROM information_schema.REFERENTIAL_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'Acessos_Facial'
   AND CONSTRAINT_NAME IN ('fk_acfac_device', 'fk_acfac_cond')
   AND DELETE_RULE IN ('RESTRICT', 'NO ACTION');

-- 7. Informativo: nada foi reescrito (logo após aplicar, tudo antigo fica NULL / 0).
SELECT
  (SELECT COUNT(*) FROM Tags) AS tags,
  (SELECT COUNT(*) FROM Tags WHERE id_device IS NOT NULL) AS tags_de_guarita,
  (SELECT COUNT(*) FROM Tags WHERE guarita_estado IS NOT NULL) AS tags_com_estado_guarita,
  (SELECT COUNT(*) FROM Facial_Devices WHERE tipo = 'guarita') AS guaritas,
  (SELECT COUNT(*) FROM Guarita_Operacoes) AS operacoes,
  (SELECT COUNT(*) FROM Guarita_Eventos) AS eventos,
  (SELECT COUNT(*) FROM Guarita_Backups) AS backups;
