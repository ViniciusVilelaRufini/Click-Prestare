-- Verificação de 2026-11-13-card-ao-vivo.sql. Esperado: as quatro linhas com ok = 1.
SELECT 'Users_Devices.card_token_inicio' AS item,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Users_Devices' AND COLUMN_NAME = 'card_token_inicio') AS ok
UNION ALL
SELECT 'Users_Devices.card_android',
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Users_Devices' AND COLUMN_NAME = 'card_android')
UNION ALL
SELECT 'Cards_Ao_Vivo (15 colunas)',
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Cards_Ao_Vivo') = 15
UNION ALL
SELECT 'fk_cards_ao_vivo_user',
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'Cards_Ao_Vivo'
      AND CONSTRAINT_NAME = 'fk_cards_ao_vivo_user' AND CONSTRAINT_TYPE = 'FOREIGN KEY');
