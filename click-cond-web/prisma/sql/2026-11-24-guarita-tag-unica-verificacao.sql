-- Verificação de 2026-11-24-guarita-tag-unica.sql. SÓ LEITURA.
-- Esperado: cada linha com ok = 1. Todo ok sai 0 ou 1, nunca NULL.

-- 1. Chave única un_tag_guarita (id_device, guarita_tipo, guarita_serial) em Tags.
SELECT 'indice unico un_tag_guarita (id_device, guarita_tipo, guarita_serial)' AS item,
  COALESCE(GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'id_device,guarita_tipo,guarita_serial', 0) AS ok
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Tags'
   AND INDEX_NAME = 'un_tag_guarita' AND NON_UNIQUE = 0;

-- 2. O índice antigo saiu.
SELECT 'idx_tag_guarita removido' AS item,
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Tags' AND INDEX_NAME = 'idx_tag_guarita') = 0 AS ok;

-- 3. A FK do Guarita continua lá.
SELECT 'FK fk_tag_guarita_device presente' AS item,
  (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'Tags' AND CONSTRAINT_NAME = 'fk_tag_guarita_device') = 1 AS ok;

-- 4. Zero duplicatas.
SELECT 'Tags sem controle repetido no mesmo Guarita' AS item,
  (SELECT COUNT(*) FROM (
     SELECT id_device, guarita_tipo, guarita_serial FROM `Tags`
      WHERE id_device IS NOT NULL AND guarita_tipo IS NOT NULL AND guarita_serial IS NOT NULL
      GROUP BY id_device, guarita_tipo, guarita_serial HAVING COUNT(*) > 1) d) = 0 AS ok;
