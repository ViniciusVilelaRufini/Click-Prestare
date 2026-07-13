-- =====================================================================
-- Schema MySQL reconstruído a partir dos arquivos DB_*.js
-- Projeto: click-cond-api
-- Charset: utf8mb4 / Engine: InnoDB
-- =====================================================================

CREATE DATABASE IF NOT EXISTS click_cond
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;
USE click_cond;

SET FOREIGN_KEY_CHECKS = 0;

-- =====================================================================
-- 1) Tabelas base (sem dependências)
-- =====================================================================

-- Endereços (genérico, usado por Condominios)
CREATE TABLE IF NOT EXISTS Endereco (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cep VARCHAR(20),
  rua VARCHAR(255),
  numero VARCHAR(20),
  complemento VARCHAR(255),
  bairro VARCHAR(255),
  cidade VARCHAR(255),
  uf VARCHAR(10),
  pais VARCHAR(100),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Endereços do app/loja (DB_Users.js usa "Addresses" — schema diferente de Endereco)
CREATE TABLE IF NOT EXISTS Addresses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cep VARCHAR(20),
  street VARCHAR(255),
  number INT,
  complement VARCHAR(255),
  neighborhood VARCHAR(255),
  city VARCHAR(255),
  uf VARCHAR(10),
  country VARCHAR(100),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Categorias de Ocorrências (referenciada por Ocorrencias)
CREATE TABLE IF NOT EXISTS Ocorrencias_Categorias (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  prioridade INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Planos de assinatura
CREATE TABLE IF NOT EXISTS Planos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(100) NOT NULL,
  dias INT NOT NULL,
  valor DECIMAL(10,2) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================================
-- 2) Users (referenciada por quase todas as tabelas)
-- =====================================================================
CREATE TABLE IF NOT EXISTS Users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  -- credenciais (DB_Users.js usa "email"; DB_Sindico/Moradores/Funcionarios usam "login")
  -- mantemos ambos para compatibilidade com o código existente
  email VARCHAR(255),
  login VARCHAR(255),
  password VARCHAR(255),
  -- perfil
  name VARCHAR(255),
  cpf VARCHAR(20),
  phone VARCHAR(50),
  profile_image VARCHAR(500),
  photo VARCHAR(500),
  -- tipo de login
  login_type VARCHAR(50),
  is_sindico TINYINT(1) DEFAULT 0,
  is_morador TINYINT(1) DEFAULT 0,
  is_funcionario TINYINT(1) DEFAULT 0,
  -- endereço (FK para Addresses, conforme DB_Users.getMyAddress)
  address INT,
  -- timestamps
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uni_email UNIQUE (email),
  CONSTRAINT uni_cpf UNIQUE (cpf),
  CONSTRAINT user_login UNIQUE (login),
  CONSTRAINT fk_users_address FOREIGN KEY (address) REFERENCES Addresses(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================================
-- 3) Condominios (depende de Endereco)
-- =====================================================================
CREATE TABLE IF NOT EXISTS Condominios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  identificacao VARCHAR(255),
  subsindico_nome VARCHAR(255),
  data_inicio_mandato DATE,
  data_termino_mandato DATE,
  num_blocos INT,
  num_aptos INT,
  vencimento DATE,
  endereco INT,
  photo VARCHAR(500),
  moeda VARCHAR(10) DEFAULT 'BRL',
  ativo TINYINT(1) DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_cond_endereco FOREIGN KEY (endereco) REFERENCES Endereco(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================================
-- 4) Apartamentos (depende de Condominios)
-- =====================================================================
CREATE TABLE IF NOT EXISTS Apartamentos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  bloco VARCHAR(50),
  apto VARCHAR(50),
  fracao VARCHAR(50),
  id_condominio INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT un_apto_cond UNIQUE (id_condominio, bloco, apto),
  CONSTRAINT fk_apto_cond FOREIGN KEY (id_condominio) REFERENCES Condominios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================================
-- 5) Pessoas vinculadas (Sindicos / Moradores / Funcionarios)
-- =====================================================================
CREATE TABLE IF NOT EXISTS Sindicos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  date_birth DATE,
  phone VARCHAR(50),
  doc_identification VARCHAR(50),
  id_user INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_sindico_user FOREIGN KEY (id_user) REFERENCES Users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS Sindicos_Condominios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_user INT NOT NULL,
  id_condominio INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sc_user FOREIGN KEY (id_user) REFERENCES Users(id) ON DELETE CASCADE,
  CONSTRAINT fk_sc_cond FOREIGN KEY (id_condominio) REFERENCES Condominios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS Moradores (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  documento VARCHAR(50),
  email VARCHAR(255),
  telefone VARCHAR(50),
  data_nascimento DATE,
  id_user INT NOT NULL,
  -- campos derivados/exibidos
  tipo VARCHAR(50),
  bloco VARCHAR(50),
  apartamento VARCHAR(50),
  id_condominio INT,
  -- campos extras (texto livre)
  extra1 VARCHAR(255),
  extra2 VARCHAR(255),
  extra3 VARCHAR(255),
  extra4 VARCHAR(255),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_mor_user FOREIGN KEY (id_user) REFERENCES Users(id) ON DELETE CASCADE,
  CONSTRAINT fk_mor_cond FOREIGN KEY (id_condominio) REFERENCES Condominios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS Apartamentos_Users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_apto INT NOT NULL,
  id_user INT NOT NULL,
  tipo VARCHAR(50),
  vencimento DATE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_au_apto FOREIGN KEY (id_apto) REFERENCES Apartamentos(id) ON DELETE CASCADE,
  CONSTRAINT fk_au_user FOREIGN KEY (id_user) REFERENCES Users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS Funcionarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  documento VARCHAR(50),
  email VARCHAR(255),
  telefone VARCHAR(50),
  funcao VARCHAR(255),
  ch VARCHAR(50),
  id_user INT NOT NULL,
  id_condominio INT NOT NULL,
  -- permissões (booleanos)
  areas_sociais TINYINT(1) DEFAULT 0,
  comunicados TINYINT(1) DEFAULT 0,
  ocorrencias TINYINT(1) DEFAULT 0,
  manutencoes_programadas TINYINT(1) DEFAULT 0,
  prestadores_servico TINYINT(1) DEFAULT 0,
  agendar_mudanca TINYINT(1) DEFAULT 0,
  cadastrar_visitante TINYINT(1) DEFAULT 0,
  apartamentos TINYINT(1) DEFAULT 0,
  -- extras
  extra1 VARCHAR(255),
  extra2 VARCHAR(255),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_func_user FOREIGN KEY (id_user) REFERENCES Users(id) ON DELETE CASCADE,
  CONSTRAINT fk_func_cond FOREIGN KEY (id_condominio) REFERENCES Condominios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================================
-- 6) Áreas Sociais
-- =====================================================================
CREATE TABLE IF NOT EXISTS Areas_Sociais (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  imagem VARCHAR(500),
  precisa_agendar TINYINT(1) DEFAULT 0,
  precisa_autorizacao TINYINT(1) DEFAULT 0,
  precisa_pagamento TINYINT(1) DEFAULT 0,
  horarios TEXT, -- JSON serializado
  capacidade INT,
  id_condominio INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_areas_cond FOREIGN KEY (id_condominio) REFERENCES Condominios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS Areas_Sociais_Agendamentos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_area_social INT NOT NULL,
  id_user INT NOT NULL,
  id_apartamento INT NOT NULL,
  data DATE,
  hora_de TIME,
  hora_ate TIME,
  status VARCHAR(50) DEFAULT 'pendente',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_asa_area FOREIGN KEY (id_area_social) REFERENCES Areas_Sociais(id) ON DELETE CASCADE,
  CONSTRAINT fk_asa_user FOREIGN KEY (id_user) REFERENCES Users(id) ON DELETE CASCADE,
  CONSTRAINT fk_asa_apto FOREIGN KEY (id_apartamento) REFERENCES Apartamentos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS Areas_Sociais_Manutencoes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_area_social INT NOT NULL,
  descricao TEXT,
  data_inicio DATE,
  hora_inicio TIME,
  data_termino DATE,
  hora_termino TIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_asm_area FOREIGN KEY (id_area_social) REFERENCES Areas_Sociais(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================================
-- 7) Assembleias e Votações
-- =====================================================================
CREATE TABLE IF NOT EXISTS Assembleias (
  id INT AUTO_INCREMENT PRIMARY KEY,
  titulo VARCHAR(255) NOT NULL,
  descricao TEXT,
  data DATE,
  hora TIME,
  local VARCHAR(255),
  link VARCHAR(500),
  user INT,
  anexos TEXT,
  id_condominio INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_assemb_cond FOREIGN KEY (id_condominio) REFERENCES Condominios(id) ON DELETE CASCADE,
  CONSTRAINT fk_assemb_user FOREIGN KEY (user) REFERENCES Users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS Votacoes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  titulo VARCHAR(255) NOT NULL,
  descricao TEXT,
  data_inicio DATE,
  data_termino DATE,
  id_assembleia INT,
  id_condominio INT NOT NULL,
  is_enquete TINYINT(1) DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_vot_assemb FOREIGN KEY (id_assembleia) REFERENCES Assembleias(id) ON DELETE CASCADE,
  CONSTRAINT fk_vot_cond FOREIGN KEY (id_condominio) REFERENCES Condominios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS Votacoes_Opcoes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_votacao INT NOT NULL,
  nome VARCHAR(255) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_vo_vot FOREIGN KEY (id_votacao) REFERENCES Votacoes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS Votacoes_Usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_opcao INT NOT NULL,
  id_user INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_vu_op FOREIGN KEY (id_opcao) REFERENCES Votacoes_Opcoes(id) ON DELETE CASCADE,
  CONSTRAINT fk_vu_user FOREIGN KEY (id_user) REFERENCES Users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================================
-- 8) Comunicados / Documentos / Manutencoes / Mudancas / Visitantes /
--    Prestadores / Agenda / Ocorrencias / Financeiro
-- =====================================================================
CREATE TABLE IF NOT EXISTS Comunicados (
  id INT AUTO_INCREMENT PRIMARY KEY,
  titulo VARCHAR(255) NOT NULL,
  descricao TEXT,
  user INT,
  id_condominio INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_comu_cond FOREIGN KEY (id_condominio) REFERENCES Condominios(id) ON DELETE CASCADE,
  CONSTRAINT fk_comu_user FOREIGN KEY (user) REFERENCES Users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS Documentos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_condominio INT NOT NULL,
  is_ata TINYINT(1) DEFAULT 0,
  nome VARCHAR(255) NOT NULL,
  link_doc VARCHAR(500),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_doc_cond FOREIGN KEY (id_condominio) REFERENCES Condominios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS Manutencoes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  descricao TEXT,
  anexos TEXT,
  user INT,
  id_condominio INT NOT NULL,
  status VARCHAR(50) DEFAULT 'Pendente',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_manut_cond FOREIGN KEY (id_condominio) REFERENCES Condominios(id) ON DELETE CASCADE,
  CONSTRAINT fk_manut_user FOREIGN KEY (user) REFERENCES Users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS Mudancas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  data DATE,
  hora_inicio TIME,
  user INT,
  id_apartamento INT NOT NULL,
  id_condominio INT NOT NULL,
  status VARCHAR(50) DEFAULT 'pendente',
  motivo_recusa TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_mud_apto FOREIGN KEY (id_apartamento) REFERENCES Apartamentos(id) ON DELETE CASCADE,
  CONSTRAINT fk_mud_cond FOREIGN KEY (id_condominio) REFERENCES Condominios(id) ON DELETE CASCADE,
  CONSTRAINT fk_mud_user FOREIGN KEY (user) REFERENCES Users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS Visitantes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  doc_identificacao VARCHAR(50),
  data_hora_inicio DATETIME,
  data_hora_termino DATETIME,
  is_visitante TINYINT(1) DEFAULT 0,
  is_prestador TINYINT(1) DEFAULT 0,
  user INT,
  id_apartamento INT NOT NULL,
  id_condominio INT NOT NULL,
  avisar TINYINT(1) DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  foto_documento VARCHAR(500),
  foto_pessoa VARCHAR(500),
  data_entrada DATETIME,
  data_saida DATETIME,
  CONSTRAINT fk_vis_apto FOREIGN KEY (id_apartamento) REFERENCES Apartamentos(id) ON DELETE CASCADE,
  CONSTRAINT fk_vis_cond FOREIGN KEY (id_condominio) REFERENCES Condominios(id) ON DELETE CASCADE,
  CONSTRAINT fk_vis_user FOREIGN KEY (user) REFERENCES Users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


CREATE TABLE IF NOT EXISTS Prestadores_servico (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  telefone VARCHAR(50),
  categorias VARCHAR(500),
  id_condominio INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_prest_cond FOREIGN KEY (id_condominio) REFERENCES Condominios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS Agenda (
  id INT AUTO_INCREMENT PRIMARY KEY,
  titulo VARCHAR(255) NOT NULL,
  descricao TEXT,
  data_inicio DATE,
  data_termino DATE,
  hora_inicio TIME,
  hora_termino TIME,
  alertar_moradores TINYINT(1) DEFAULT 0,
  user INT,
  id_condominio INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_agenda_cond FOREIGN KEY (id_condominio) REFERENCES Condominios(id) ON DELETE CASCADE,
  CONSTRAINT fk_agenda_user FOREIGN KEY (user) REFERENCES Users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS Ocorrencias (
  id INT AUTO_INCREMENT PRIMARY KEY,
  descricao TEXT,
  anexos TEXT,
  user INT,
  id_condominio INT NOT NULL,
  tipo INT, -- FK para Ocorrencias_Categorias
  status VARCHAR(50) DEFAULT 'Pendente',
  resposta TEXT,
  resposta_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_oco_cond FOREIGN KEY (id_condominio) REFERENCES Condominios(id) ON DELETE CASCADE,
  CONSTRAINT fk_oco_user FOREIGN KEY (user) REFERENCES Users(id) ON DELETE SET NULL,
  CONSTRAINT fk_oco_cat FOREIGN KEY (tipo) REFERENCES Ocorrencias_Categorias(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS Financeiro (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(255),
  tipo VARCHAR(100),
  valor DECIMAL(10,2),
  data DATE,
  data_vencimento DATE,
  categoria VARCHAR(255),
  conta VARCHAR(255),
  descricao TEXT,
  cliente VARCHAR(255),
  forma_pagamento VARCHAR(100),
  parcelas VARCHAR(20),
  nome_operador VARCHAR(255),
  id_condominio INT NOT NULL,
  photo VARCHAR(500),
  pago TINYINT(1) DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_fin_cond FOREIGN KEY (id_condominio) REFERENCES Condominios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================================
-- 9) Assinaturas
-- =====================================================================
CREATE TABLE IF NOT EXISTS Assinaturas_Moradores (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_user INT NOT NULL,
  email_user VARCHAR(255),
  codigo VARCHAR(255),
  data_ini DATE,
  data_fim DATE,
  dias INT,
  plano VARCHAR(100),
  plataforma VARCHAR(100),
  valor DECIMAL(10,2),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_am_user FOREIGN KEY (id_user) REFERENCES Users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS Assinaturas_Condominios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_condominio INT NOT NULL,
  email_user VARCHAR(255),
  codigo VARCHAR(255),
  data_ini DATE,
  data_fim DATE,
  dias INT,
  plano VARCHAR(100),
  plataforma VARCHAR(100),
  valor DECIMAL(10,2),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ac_cond FOREIGN KEY (id_condominio) REFERENCES Condominios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================================
-- 10) Tabelas de loja/e-commerce (referenciadas em DB_Users.js)
--      Mantidas para compatibilidade com queries existentes.
-- =====================================================================
CREATE TABLE IF NOT EXISTS Authors (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255),
  email VARCHAR(255),
  password VARCHAR(255),
  profile_image VARCHAR(500),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS Products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(255),
  title VARCHAR(255),
  description TEXT,
  price DECIMAL(10,2),
  images VARCHAR(500),
  is_fisico TINYINT(1) DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS Products_Favorites (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_user INT NOT NULL,
  id_product INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pf_user FOREIGN KEY (id_user) REFERENCES Users(id) ON DELETE CASCADE,
  CONSTRAINT fk_pf_prod FOREIGN KEY (id_product) REFERENCES Products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS Authors_Favorites (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_user INT NOT NULL,
  id_author INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_af_user FOREIGN KEY (id_user) REFERENCES Users(id) ON DELETE CASCADE,
  CONSTRAINT fk_af_author FOREIGN KEY (id_author) REFERENCES Authors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS Shopping_Cart (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_user INT NOT NULL,
  id_product INT NOT NULL,
  quantity INT DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_shopcart_user FOREIGN KEY (id_user) REFERENCES Users(id) ON DELETE CASCADE,
  CONSTRAINT fk_shopcart_prod FOREIGN KEY (id_product) REFERENCES Products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS Orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_user INT NOT NULL,
  price DECIMAL(10,2),
  payment_id VARCHAR(255),
  address INT,
  received_at DATETIME,
  dispatched_at DATETIME,
  transport_at DATETIME,
  delivered_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ord_user FOREIGN KEY (id_user) REFERENCES Users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ord_addr FOREIGN KEY (address) REFERENCES Addresses(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS Products_Orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_order INT NOT NULL,
  id_product INT NOT NULL,
  price DECIMAL(10,2),
  quantity INT DEFAULT 1,
  present TINYINT(1) DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_po_order FOREIGN KEY (id_order) REFERENCES Orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_po_prod FOREIGN KEY (id_product) REFERENCES Products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================================
-- Assistente IA (RAG) — armazenamento de embeddings de atas/documentos
-- e histórico de conversas. Ver src/services/RagService.js.
-- ============================================================================
CREATE TABLE IF NOT EXISTS Rag_Embeddings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_condominio INT NOT NULL,
  source_type VARCHAR(20) NOT NULL,   -- 'ata' | 'documento'
  source_id INT NOT NULL,             -- Documentos.id
  chunk_index INT NOT NULL,
  chunk_text TEXT NOT NULL,
  embedding JSON NOT NULL,            -- vetor float[768] (text-embedding-004)
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_rag_cond (id_condominio),
  INDEX idx_rag_source (id_condominio, source_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS Chat_Ia_Historico (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_condominio INT NOT NULL,
  id_user INT NOT NULL,
  papel VARCHAR(12) NOT NULL,         -- 'user' | 'assistant'
  mensagem TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_chatia_cond_user (id_condominio, id_user)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;
