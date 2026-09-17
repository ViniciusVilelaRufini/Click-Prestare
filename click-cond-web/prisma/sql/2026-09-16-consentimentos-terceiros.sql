-- Consentimento biométrico de quem NÃO tem conta no sistema: visitante e
-- prestador de serviço.
--
-- A tabela `Consentimentos` cobre morador e síndico, que têm `Users.id` e
-- passam pela tela de aceite do app. Visitante e prestador não têm conta
-- nenhuma — e o rosto deles ia para o terminal sem registro de autorização.
-- Biometria é dado sensível (Art. 11 da LGPD) e exige consentimento
-- específico e destacado, de quem quer que seja o titular.
--
-- O Railway NÃO roda migração automática: aplicar à mão e verificar ANTES do
-- deploy da API, senão o Prisma quebra o módulo no boot.
--
-- Idempotente: pode rodar duas vezes.

CREATE TABLE IF NOT EXISTS `Consentimentos_Terceiros` (
  `id`            INT NOT NULL AUTO_INCREMENT,
  `id_condominio` INT NOT NULL,

  -- 'visitante' | 'prestador'. Guardado para auditoria e para saber de qual
  -- tabela veio o cadastro; NÃO é chave de busca (ver `doc` abaixo).
  `tipo_pessoa`   VARCHAR(20) NOT NULL,

  -- Registro que originou a declaração (Visitantes.id / Prestadores_servico.id).
  `id_pessoa`     INT NOT NULL,

  -- CPF/documento só com dígitos. ESTA é a chave de busca: `Visitantes` tem
  -- uma linha por VISITA, e o mesmo CPF voltando semana que vem não pode ter
  -- de declarar tudo de novo. Nulo quando o cadastro não tem documento — aí a
  -- busca cai no par (tipo_pessoa, id_pessoa).
  `doc`           VARCHAR(20) NULL,

  -- Versão do texto vigente no momento da declaração.
  `versao`        VARCHAR(20) NOT NULL,

  -- 1 autorizou a biometria, 0 recusou/revogou. A recusa também é fato a
  -- registrar.
  `aceito`        TINYINT NOT NULL,

  -- O titular declarou ser maior de 18 anos. Sem isto o rosto não vai para o
  -- terminal, ainda que `aceito = 1`.
  `maior_idade`   TINYINT NOT NULL DEFAULT 0,

  -- Quem colheu a declaração. O titular não tem conta, então a
  -- responsabilidade é de quem cadastrou — e isso precisa ter nome.
  -- `declarado_por_id` é Users.id quando existe (morador/síndico pelo app);
  -- fica nulo para o porteiro, que autentica por Funcionarios_Portaria.
  `declarado_por_id`   INT NULL,
  `declarado_por_nome` VARCHAR(255) NULL,

  `registrado_em` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  KEY `idx_consent3_doc` (`id_condominio`, `doc`, `registrado_em`),
  KEY `idx_consent3_pessoa` (`id_condominio`, `tipo_pessoa`, `id_pessoa`, `registrado_em`),

  CONSTRAINT `fk_consent3_cond` FOREIGN KEY (`id_condominio`)
    REFERENCES `Condominios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- APPEND-ONLY, como `Consentimentos`: nunca fazer UPDATE. Revogação é INSERT
-- novo com `aceito = 0`. O histórico é o que dá sustentação jurídica.
