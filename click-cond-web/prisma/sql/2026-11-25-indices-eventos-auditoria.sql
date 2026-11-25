-- Índices do Log de Eventos e do Log de Auditoria (varredura 25/11/2026).
--
-- Por quê: o Log de Eventos (apps/api/src/app/relatorios/eventos-espinha.ts) filtra cada ramo por
-- condomínio + período e ordena pela data do ramo. Sem índice (id_condominio, <data>) cada ramo
-- ordena todas as linhas do condomínio a cada página. O ramo de dispositivos lê audit_logs por
-- (id_condominio, modulo, created_at). E o banco tem índices DUPLICADOS (mesmas colunas, nomes
-- diferentes) que só custam escrita e espaço: idx_enc_cond_status e idx_encomendas_cond_status
-- repetem o Encomendas_id_condominio_status_idx do schema; idx_ocorrencias_cond repete o
-- Ocorrencias_id_condominio_idx. Os índices declarados no schema.prisma ficam.
--
-- Idempotente (cada passo confere o information_schema). Seguro com o código antigo no ar
-- (só índices). MySQL 8.4. lock_wait_timeout de 10 s: se outra sessão segurar o metadata
-- lock, o passo desiste; rodar de novo.

SET SESSION lock_wait_timeout = 10;

DROP PROCEDURE IF EXISTS prestare_idx_criar;
DROP PROCEDURE IF EXISTS prestare_idx_remover;
DELIMITER //
CREATE PROCEDURE prestare_idx_criar(IN tabela VARCHAR(64), IN nome VARCHAR(64), IN colunas VARCHAR(255))
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = tabela AND INDEX_NAME = nome) THEN
    SET @ddl = CONCAT('CREATE INDEX `', nome, '` ON `', tabela, '` (', colunas, ')');
    PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
  END IF;
END //
CREATE PROCEDURE prestare_idx_remover(IN tabela VARCHAR(64), IN nome VARCHAR(64))
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = tabela AND INDEX_NAME = nome) THEN
    SET @ddl = CONCAT('DROP INDEX `', nome, '` ON `', tabela, '`');
    PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
  END IF;
END //
DELIMITER ;

-- Novos (os mesmos nomes do schema.prisma)
CALL prestare_idx_criar('Encomendas', 'idx_enc_cond_recebido', '`id_condominio`, `recebido_em`');
CALL prestare_idx_criar('Ocorrencias', 'idx_oco_cond_created', '`id_condominio`, `created_at`');
CALL prestare_idx_criar('visitas', 'idx_visita_cond_saida', '`id_condominio`, `data_saida`');
CALL prestare_idx_criar('audit_logs', 'idx_audit_condo_modulo_created', '`id_condominio`, `modulo`, `created_at`');

-- Duplicados fora do schema (o equivalente declarado continua atendendo as FKs)
CALL prestare_idx_remover('Encomendas', 'idx_enc_cond_status');
CALL prestare_idx_remover('Encomendas', 'idx_encomendas_cond_status');
CALL prestare_idx_remover('Ocorrencias', 'idx_ocorrencias_cond');

DROP PROCEDURE IF EXISTS prestare_idx_criar;
DROP PROCEDURE IF EXISTS prestare_idx_remover;
