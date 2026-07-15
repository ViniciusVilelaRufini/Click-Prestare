# Deploy — Feature "Vagas" (liberar vaga p/ visitante/inquilino)

O Railway **não roda** `prisma migrate`/`db push` automaticamente. Rode o SQL abaixo
**manualmente no banco de produção ANTES do deploy** que sobe o código novo
(ver o mesmo padrão em [[facial-sync-pessoas-tabelas]] / [[financeiro-deploy-manual]]).

## 1. Coluna de vagas no apartamento

```sql
ALTER TABLE Apartamentos
  ADD COLUMN qtd_vagas INT NOT NULL DEFAULT 0;
```

## 2. Tabela Vagas (uma linha por vaga ocupada/liberada)

```sql
CREATE TABLE Vagas (
  id                      INT           NOT NULL AUTO_INCREMENT,
  id_condominio           INT           NOT NULL,
  id_apartamento          INT           NOT NULL,
  id_morador_titular      INT           NOT NULL,
  tipo_ocupacao           VARCHAR(20)   NOT NULL DEFAULT 'proprio',
  id_veiculo              INT           NULL,
  id_visitante            INT           NULL,
  id_morador_beneficiario INT           NULL,
  placa                   VARCHAR(20)   NULL,
  inicio                  DATETIME      NULL,
  fim                     DATETIME      NULL,
  ativo                   TINYINT       NOT NULL DEFAULT 1,
  created_at              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_vaga_apto (id_apartamento),
  KEY idx_vaga_cond (id_condominio),
  KEY fk_vaga_titular (id_morador_titular),
  KEY fk_vaga_benef (id_morador_beneficiario),
  KEY fk_vaga_veiculo (id_veiculo),
  KEY fk_vaga_visitante (id_visitante),
  CONSTRAINT fk_vaga_cond      FOREIGN KEY (id_condominio)           REFERENCES Condominios (id)  ON DELETE CASCADE,
  CONSTRAINT fk_vaga_apto      FOREIGN KEY (id_apartamento)          REFERENCES Apartamentos (id) ON DELETE CASCADE,
  CONSTRAINT fk_vaga_titular   FOREIGN KEY (id_morador_titular)      REFERENCES Moradores (id)    ON DELETE CASCADE,
  CONSTRAINT fk_vaga_benef     FOREIGN KEY (id_morador_beneficiario) REFERENCES Moradores (id),
  CONSTRAINT fk_vaga_veiculo   FOREIGN KEY (id_veiculo)              REFERENCES Veiculos (id),
  CONSTRAINT fk_vaga_visitante FOREIGN KEY (id_visitante)            REFERENCES Visitantes (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

> `tipo_ocupacao`: `proprio` | `inquilino` | `visitante`.
> Vagas livres = `Apartamentos.qtd_vagas` − linhas em `Vagas` com `ativo=1` do apto.
> As vazias **não** são materializadas.

## 3. Depois do SQL

- `npx prisma generate` (já refletido em `apps/api/src/app/prisma/generated`).
- Deploy do código (push master → Railway).
- No app: síndico define "Quantidade de vagas" no apartamento; morador libera vaga em
  **Meus Veículos → ícone de vagas** → visitante cadastrado ou inquilino, com período
  (visitante grava `data_hora_inicio/termino` + `liberado=1` em `Visitantes`).
