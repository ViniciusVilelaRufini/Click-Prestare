-- Verificação de 2026-11-24-apartamentos-users-unico.sql. SÓ LEITURA.
-- Rodar ANTES (item 1 diz se a chave pode entrar) e DEPOIS de aplicar.
-- Esperado depois: item 1 sem linhas e cada linha com ok = 1. Todo ok sai 0 ou 1.

-- 1. Duplicatas (id_apto, id_user), com as linhas de Moradores do usuário na
-- unidade (mesmo condomínio, bloco e número). Esperado: nenhuma linha.
SELECT d.id_apto, d.id_user, d.n, d.ids AS ids_apartamentos_users,
  (SELECT GROUP_CONCAT(CONCAT(m.id, IF(m.foto_pessoa IS NULL, '', ' foto'), IF(m.tag_rfid IS NULL, '', ' tag'),
                              IF(m.qrcode_acesso IS NULL, '', ' qr')) ORDER BY m.id SEPARATOR ', ')
     FROM `Moradores` m
     JOIN `Apartamentos` a ON a.id = d.id_apto
    WHERE m.id_user = d.id_user AND m.id_condominio = a.id_condominio
      AND COALESCE(m.bloco, '') = COALESCE(a.bloco, '') AND COALESCE(m.apartamento, '') = COALESCE(a.apto, '')
  ) AS moradores_na_unidade
  FROM (SELECT id_apto, id_user, COUNT(*) AS n, GROUP_CONCAT(id ORDER BY id) AS ids
          FROM `Apartamentos_Users`
         GROUP BY id_apto, id_user
        HAVING COUNT(*) > 1) d
 ORDER BY d.id_apto, d.id_user;

-- 2. Chave única uq_au_apto_user (id_apto, id_user).
SELECT 'indice unico uq_au_apto_user (id_apto, id_user)' AS item,
  COALESCE(GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'id_apto,id_user', 0) AS ok
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Apartamentos_Users'
   AND INDEX_NAME = 'uq_au_apto_user' AND NON_UNIQUE = 0;

-- 3. As FKs continuam (apto e usuário em CASCADE).
SELECT 'FKs fk_au_apto e fk_au_user presentes' AS item,
  (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'Apartamentos_Users'
      AND CONSTRAINT_NAME IN ('fk_au_apto', 'fk_au_user')) = 2 AS ok;

-- 4. Informativo: índices da tabela.
SHOW INDEX FROM `Apartamentos_Users`;
