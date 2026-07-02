# Deploy — Correções da Área de Finanças

> **REGRA DE OURO:** o Railway **não** aplica migrations/`prisma db push` automaticamente.
> Todo SQL abaixo roda **manualmente no MySQL de produção ANTES do deploy do código**.
> Se o código chegar antes da coluna, o Prisma quebra o módulo inteiro.

## 1. SQL manual (rodar ANTES do deploy)

### 1.1 Coluna de comprovante (obrigatório para este deploy)

```sql
ALTER TABLE Financeiro ADD COLUMN url_comprovante VARCHAR(500) NULL AFTER url_boleto;
```

### 1.2 Limpeza de dados (opcional via SQL — preferir o endpoint, ver 2.1)

Conferir antes de apagar:

```sql
-- Unidades fantasma
SELECT id, apto, bloco, id_condominio FROM Apartamentos
WHERE apto REGEXP '^0+$' OR LOWER(TRIM(bloco)) IN ('condominio', 'condomínio');

-- Cobranças pendentes de R$ 0,00
SELECT id, nome, valor, id_condominio FROM Financeiro
WHERE tipo = 'C' AND pago = 0 AND (valor <= 0 OR valor IS NULL);
```

### 1.3 Tabelas do CRM real (obrigatório para o faturamento do CRM)

```sql
CREATE TABLE Crm_Faturas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_condominio INT NOT NULL,
  referencia VARCHAR(7) NOT NULL,
  valor DECIMAL(10,2) NOT NULL,
  vencimento DATE NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pendente',
  metodo_pagamento VARCHAR(50) NULL,
  data_pagamento DATETIME NULL,
  baixa_por VARCHAR(255) NULL,
  baixa_motivo VARCHAR(500) NULL,
  pix_copia_cola TEXT NULL,
  estimada TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_crmfat_cond_ref (id_condominio, referencia),
  KEY Crm_Faturas_status_idx (status)
);

CREATE TABLE Crm_Config (
  id INT AUTO_INCREMENT PRIMARY KEY,
  chave VARCHAR(100) NOT NULL UNIQUE,
  valor TEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE Crm_Disparos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_condominio INT NOT NULL,
  id_fatura INT NULL,
  tipo VARCHAR(50) NOT NULL,
  telefone VARCHAR(30) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'enviado',
  erro_msg VARCHAR(500) NULL,
  mensagem TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY Crm_Disparos_id_condominio_idx (id_condominio)
);
```

## 2. Após o deploy do código

### 2.1 Limpeza auditada (recomendado, no lugar do SQL cru)

Com um token de **síndico** do condomínio afetado (ou admin):

```bash
curl -X POST https://<api>.railway.app/financeiro/admin/limpar-cobrancas-zeradas \
  -H "Authorization: <JWT>" -H "Content-Type: application/json" \
  -d '{"id_condominio": <ID>}'
```

Remove cobranças pendentes de R$ 0,00 + cobranças pendentes de unidades
fantasma + os registros de Apartamentos fantasma. Idempotente e registrado
na Auditoria.

### 2.2 Verificação

```bash
# Percentual de inadimplência deve refletir só dívidas reais (> R$ 0,00)
curl "https://<api>.railway.app/financeiro/inadimplencia/dashboard?id_condominio=<ID>&mes=07&ano=2026" \
  -H "Authorization: <JWT>"

# Cadastrar apto "000" deve retornar 400
# Ativar recorrência com valor 0 em /financeiro/config-auto deve retornar 400
```

## 3. Pagamento online (OpenPix/Woovi)

### 3.1 Variáveis de ambiente no Railway (serviço da API)

| Env | Valor | Obrigatória |
|---|---|---|
| `OPENPIX_APP_ID` | AppID da conta OpenPix/Woovi (API → AppID) | Sim, para gerar Pix |
| `OPENPIX_WEBHOOK_TOKEN` | Segredo gerado por você (ex.: `openssl rand -hex 24`) | Sim, para confirmar pagamento |
| `ASAAS_WEBHOOK_TOKEN` | Token do webhook Asaas | Só se usar Asaas |

Sem `OPENPIX_APP_ID`, as cobranças continuam sendo criadas normalmente, só
sem Pix copia-e-cola automático. Sem `OPENPIX_WEBHOOK_TOKEN`, o endpoint de
webhook **recusa tudo** (seguro por padrão).

### 3.2 Cadastrar o webhook no painel OpenPix/Woovi

- URL: `https://<api>.railway.app/financeiro/webhook/openpix?token=<OPENPIX_WEBHOOK_TOKEN>`
  (o endpoint aceita o token via query `?token=` ou via header `x-webhook-token`)
- Evento: **OPENPIX:CHARGE_COMPLETED**

### 3.3 Teste ponta a ponta

1. Criar cobrança de morador no app (síndico) → conferir que `pix_copia_cola`
   veio preenchido (morador vê botão "Pagar Pix" com QR).
2. Simular confirmação (ou pagar de verdade em sandbox):

```bash
curl -X POST "https://<api>.railway.app/financeiro/webhook/openpix?token=<TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"event":"OPENPIX:CHARGE_COMPLETED","charge":{"correlationID":"financeiro_<ID_LANCAMENTO>","value":<VALOR_EM_CENTAVOS>}}'
```

3. A fatura deve virar **paga** no app; pagamento parcial (value menor) **não**
   marca como pago (proteção já existente).
4. POST sem token → deve retornar 401.

## 4. Ordem segura de deploy

1. `ALTER TABLE` (item 1.1) no MySQL de produção.
2. Deploy da API (Railway).
3. Endpoint de limpeza (item 2.1) por condomínio afetado.
4. Configurar envs OpenPix (item 3.1) + webhook no painel (3.2).
5. Release do app Flutter (após Fases 2–4 do plano) — o backend novo é
   retrocompatível com o app antigo.
