-- Integração Superlógica — colunas de vínculo entre o Clique e o ERP.
-- Ver INTEGRACAO_SUPERLOGICA.md na raiz do repositório.
--
-- Migração MANUAL (Railway = MySQL 8; não roda `prisma db push`/`migrate`).
-- Rodar UMA vez no banco de produção ANTES de subir o deploy que inclui o
-- módulo `superlogica`.
--
-- Todas as colunas são NULL: nada muda para os dados existentes. Enquanto
-- Condominios.id_superlogica_cond estiver vazio, o condomínio é ignorado pela
-- integração — a coluna é o próprio interruptor de ativação.
--
-- MySQL 8 não tem `ADD COLUMN IF NOT EXISTS`, então cada bloco consulta o
-- information_schema antes. Reexecutar é seguro (no-op).

-- Condominios.id_superlogica_cond — id_condominio_cond no ERP. Preenchido na
-- ativação comercial, pelo CRM.
SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE Condominios ADD COLUMN id_superlogica_cond INT NULL',
    'SELECT "Condominios.id_superlogica_cond ja existe"'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'Condominios'
    AND COLUMN_NAME = 'id_superlogica_cond'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Apartamentos.id_superlogica_uni — id_unidade_uni no ERP. Gravado no momento
-- em que o apartamento é criado pela importação, nunca casado por texto.
SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE Apartamentos ADD COLUMN id_superlogica_uni INT NULL',
    'SELECT "Apartamentos.id_superlogica_uni ja existe"'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'Apartamentos'
    AND COLUMN_NAME = 'id_superlogica_uni'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Financeiro.id_externo — id_recebimento_recb no ERP.
SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE Financeiro ADD COLUMN id_externo VARCHAR(50) NULL',
    'SELECT "Financeiro.id_externo ja existe"'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'Financeiro'
    AND COLUMN_NAME = 'id_externo'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Financeiro.origem — 'superlogica' ou NULL (lançamento nativo do Clique).
SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE Financeiro ADD COLUMN origem VARCHAR(20) NULL',
    'SELECT "Financeiro.origem ja existe"'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'Financeiro'
    AND COLUMN_NAME = 'origem'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Índice único (origem, id_condominio, id_externo): impede a sincronização de
-- duplicar lançamento ao reprocessar o mesmo período. Em MySQL, NULLs não
-- colidem em índice único — os lançamentos nativos (origem NULL) não são
-- afetados.
--
-- id_condominio entra na chave DE PROPÓSITO. A Superlógica não documenta se o
-- id_recebimento_recb é único entre condomínios da mesma licença; se não for,
-- uma cobrança sobrescreveria a de outro condomínio no upsert, e o morador
-- veria o boleto e o Pix de um prédio alheio. Com o condomínio na chave, a
-- colisão é impossível — sem depender de uma suposição não verificada.
--
-- A primeira versão desta migração criou o índice sem id_condominio; o bloco
-- abaixo derruba aquela versão antes de recriar.
SET @sql := (
  SELECT IF(
    COUNT(*) = 3,
    'SELECT "un_fin_origem_externo ja esta correto"',
    'DROP INDEX un_fin_origem_externo ON Financeiro'
  )
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'Financeiro'
    AND INDEX_NAME = 'un_fin_origem_externo'
);
-- Se o índice não existe (COUNT = 0), o DROP falharia. Só executa se houver
-- algo para derrubar.
SET @existe := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'Financeiro'
    AND INDEX_NAME = 'un_fin_origem_externo'
);
SET @sql := IF(@existe = 0, 'SELECT "nada a derrubar"', @sql);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'CREATE UNIQUE INDEX un_fin_origem_externo ON Financeiro (origem, id_condominio, id_externo)',
    'SELECT "un_fin_origem_externo ja existe"'
  )
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'Financeiro'
    AND INDEX_NAME = 'un_fin_origem_externo'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
