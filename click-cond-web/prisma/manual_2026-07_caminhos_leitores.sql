-- Caminho de leitores — sequência física de entrada (etapa 1, etapa 2, ...).
-- Migração MANUAL (Railway = MySQL 8; não roda `prisma db push`).
--
-- Rodar UMA vez no banco de produção ANTES de subir o deploy que inclui o
-- módulo caminhos-acesso. Sem estas tabelas, a aba "Caminho de Leitores"
-- responde 500 ao listar.
--
-- Usa CREATE TABLE IF NOT EXISTS, então reexecutar é seguro.
--
-- Para que serve: no condomínio com antecâmara, o portão da rua abre por LPR
-- e, já dentro, o terminal facial libera o portão interno. Sem o caminho, o
-- acionamento cai no comportamento legado (leitor que identifica dispara
-- TODAS as aberturas do condomínio) e a leitura da placa abriria os dois
-- portões de uma vez.

CREATE TABLE IF NOT EXISTS caminhos_acesso (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_condominio INT NOT NULL,
  nome VARCHAR(150) NOT NULL,
  descricao VARCHAR(255) NULL,
  ativo TINYINT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_camac_cond (id_condominio),
  CONSTRAINT fk_camac_cond FOREIGN KEY (id_condominio)
    REFERENCES Condominios (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS caminhos_etapas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_caminho INT NOT NULL,
  -- 1 = primeira etapa percorrida, 2 = seguinte, e assim por diante.
  ordem INT NOT NULL,
  -- Aparelho que IDENTIFICA nesta etapa (LPR, facial, tag, QR).
  id_leitor INT NOT NULL,
  -- Aparelho que ABRE nesta etapa (botoeira/catraca).
  -- NULL = etapa só registra a passagem, sem acionar nada.
  id_abertura INT NULL,
  UNIQUE KEY un_camet_ordem (id_caminho, ordem),
  INDEX idx_camet_leitor (id_leitor),
  INDEX idx_camet_abertura (id_abertura),
  CONSTRAINT fk_camet_cam FOREIGN KEY (id_caminho)
    REFERENCES caminhos_acesso (id) ON DELETE CASCADE,
  CONSTRAINT fk_camet_leitor FOREIGN KEY (id_leitor)
    REFERENCES Facial_Devices (id) ON DELETE CASCADE,
  -- SET NULL: apagar a botoeira não pode derrubar a etapa inteira; ela fica
  -- sem abertura e o console mostra a pendência.
  CONSTRAINT fk_camet_abertura FOREIGN KEY (id_abertura)
    REFERENCES Facial_Devices (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
