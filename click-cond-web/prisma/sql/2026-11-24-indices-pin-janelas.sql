-- Índices de PIN e de janela de visita (D7, varredura 24/11).
--
-- Por quê:
--   - gerarPinUnicoVisita (common/visita-passagem.util.ts) confere o PIN novo
--     contra TODAS as visitas/visitantes em aberto, sem id_condominio:
--     WHERE codigo_acesso = ? AND data_saida IS NULL. O único índice com
--     codigo_acesso (idx_visita_cond_pin, em visitas) começa por id_condominio
--     e não serve; em Visitantes não há nenhum. Cada PIN gerado varria as duas
--     tabelas inteiras.
--   - Os ticks do facial (expiração automática, pré-enrolamento, dias da
--     semana) e a retenção de visitantes filtram data_hora_termino /
--     data_hora_inicio em todos os condomínios, sem índice.
--
-- O que cria (só índices comuns; nenhuma coluna muda):
--   visitas:    idx_visita_pin_saida (codigo_acesso, data_saida)
--               idx_visita_inicio    (data_hora_inicio)
--               idx_visita_termino   (data_hora_termino)
--   Visitantes: idx_vis_pin_saida    (codigo_acesso, data_saida)
--               idx_vis_inicio       (data_hora_inicio)
--               idx_vis_termino      (data_hora_termino)
--
-- Ordem: pode aplicar antes ou depois do deploy (o código não depende dos
-- nomes; o schema.prisma já os declara). ADD INDEX é online no MySQL 8.4
-- (INPLACE, sem bloquear escrita); Visitantes tem fotos em LONGTEXT, então o
-- índice leva mais que nas outras tabelas, ainda em segundos com o volume atual.
--
-- Idempotente: cada passo confere o information_schema e vira no-op se o
-- índice já existe. Rodar numa única sessão (usa @sql). lock_wait_timeout de 10 s.

SET SESSION lock_wait_timeout = 10;

-- 1. visitas.idx_visita_pin_saida (codigo_acesso, data_saida)
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'visitas' AND INDEX_NAME = 'idx_visita_pin_saida') = 0,
  'ALTER TABLE `visitas` ADD INDEX `idx_visita_pin_saida` (`codigo_acesso`, `data_saida`), ALGORITHM=INPLACE, LOCK=NONE',
  'SELECT ''idx_visita_pin_saida: ja existe'' AS passo_1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. visitas.idx_visita_inicio (data_hora_inicio)
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'visitas' AND INDEX_NAME = 'idx_visita_inicio') = 0,
  'ALTER TABLE `visitas` ADD INDEX `idx_visita_inicio` (`data_hora_inicio`), ALGORITHM=INPLACE, LOCK=NONE',
  'SELECT ''idx_visita_inicio: ja existe'' AS passo_2');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3. visitas.idx_visita_termino (data_hora_termino)
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'visitas' AND INDEX_NAME = 'idx_visita_termino') = 0,
  'ALTER TABLE `visitas` ADD INDEX `idx_visita_termino` (`data_hora_termino`), ALGORITHM=INPLACE, LOCK=NONE',
  'SELECT ''idx_visita_termino: ja existe'' AS passo_3');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4. Visitantes.idx_vis_pin_saida (codigo_acesso, data_saida)
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Visitantes' AND INDEX_NAME = 'idx_vis_pin_saida') = 0,
  'ALTER TABLE `Visitantes` ADD INDEX `idx_vis_pin_saida` (`codigo_acesso`, `data_saida`), ALGORITHM=INPLACE, LOCK=NONE',
  'SELECT ''idx_vis_pin_saida: ja existe'' AS passo_4');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 5. Visitantes.idx_vis_inicio (data_hora_inicio)
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Visitantes' AND INDEX_NAME = 'idx_vis_inicio') = 0,
  'ALTER TABLE `Visitantes` ADD INDEX `idx_vis_inicio` (`data_hora_inicio`), ALGORITHM=INPLACE, LOCK=NONE',
  'SELECT ''idx_vis_inicio: ja existe'' AS passo_5');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 6. Visitantes.idx_vis_termino (data_hora_termino)
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Visitantes' AND INDEX_NAME = 'idx_vis_termino') = 0,
  'ALTER TABLE `Visitantes` ADD INDEX `idx_vis_termino` (`data_hora_termino`), ALGORITHM=INPLACE, LOCK=NONE',
  'SELECT ''idx_vis_termino: ja existe'' AS passo_6');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
