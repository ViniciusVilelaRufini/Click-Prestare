# Plano de Migração 100% do Banco de Dados para AWS (Amazon RDS MySQL) — Design

Documento de arquitetura, especificação e roteiro de migração completa do banco de dados MySQL hospedado no Railway para o **Amazon RDS for MySQL (AWS)**, garantindo segurança empresarial, conformidade LGPD, alta disponibilidade e zero perda de dados.

- **Status:** Planejado e Documentado (Aguardando momento de execução).
- **Data:** 2026-09-17.
- **Repositório:** `c:\Users\vinic\Desktop\Click-with-Prestare`
- **Autor/Responsável:** Equipe de Engenharia / Antigravity

---

## 1. Contexto e Motivação

Atualmente, o backend do Click Prestare (API NestJS em monorepo Nx com Prisma ORM) utiliza um banco de dados MySQL hospedado no Railway (Plano Hobby). 

Embora o Railway atenda bem aos primeiros estágios de desenvolvimento, a evolução do sistema para contratos formais de condomínios e controle de acesso exige requisitos corporativos que demandam a migração para a AWS:
1. **Backups Automatizados com Point-in-Time Recovery (PITR):** Capacidade de restaurar o banco para qualquer segundo específico em uma janela de retenção de 7 a 35 dias (essencial contra falhas humanas ou corrupção de dados).
2. **Conformidade com a LGPD e Auditoria:** Criptografia em repouso gerenciada via AWS KMS (AES-256) e logs formais de acesso.
3. **Consolidação de Nuvem:** O sistema já utiliza `@aws-sdk/client-s3` para armazenamento de arquivos e imagens na AWS; migrar o banco consolida fatura, segurança e governança.
4. **Custo Otimizado (Hobby / Free Tier):** Utilização do AWS Free Tier (750 horas/mês gratuitas por 12 meses de instância `db.t4g.micro` + 20 GB de SSD) ou custo fixo reduzido (~$13-$16/mês).

---

## 2. Decisões Arquiteturais

| Decisão | Escolha | Motivo Técnico |
|---|---|---|
| **Serviço de Banco de Dados** | **Amazon RDS for MySQL 8.0+** | Compatibilidade 100% nativa com o `schema.prisma` existente (1.400+ linhas de definições e tipos MySQL), sem refatoração de código. |
| **Família da Instância** | `db.t4g.micro` (ARM Graviton2, 2 vCPUs, 1 GB RAM) | Melhor relação custo-benefício, maior performance por vCPU em relação a processadores Intel x86 e inclusão no AWS Free Tier de 12 meses. |
| **Armazenamento** | **20 GB gp3** com Storage Autoscaling até 100 GB | SSD de uso geral com 3.000 IOPS de base, escalando automaticamente caso o condomínio aumente registros de acessos e fotos. |
| **Região AWS** | `us-east-1` (N. Virginia) ou `sa-east-1` (São Paulo) | `us-east-1` oferece menor custo e cobertura garantida de Free Tier; `sa-east-1` tem menor latência (5-15ms) caso o tráfego seja estritamente no Brasil. |
| **Segurança e Criptografia** | **AWS KMS (AES-256) + SSL/TLS obrigatório** | Criptografia dos dados no disco e em trânsito (`sslaccept=strict`), em conformidade direta com o DPA e a LGPD. |
| **Estratégia de Conectividade** | **VPC com Security Group restritivo** | Porta 3306 bloqueada para a internet em geral, aberta apenas para o IP de saída da API e o IP do administrador durante a migração. |
| **Estratégia de Downtime** | **Janela de Manutenção de 15-30 minutos** | Congelamento temporário de escritas no Railway para dump consistente, importação e chaveamento sem perda de transações. |

---

## 3. Especificação do Provisionamento na AWS

### 3.1 Parâmetros da Instância RDS Provisionada
- **DB Engine:** MySQL Community Edition 8.0.
- **DB Instance Identifier:** `database-1` (Provisionado).
- **Endpoint Confirmado:** `database-1.crq2ie2ww3dh.sa-east-1.rds.amazonaws.com`
- **Porta:** `3306` (Testada e validada: `TcpTestSucceeded = True`).
- **Região:** `sa-east-1` (América do Sul - São Paulo).
- **Classe da Instância:** `db.t4g.micro` (ARM Graviton2, Free Tier).
- **Master Username:** `admin` (ou configurado na criação).

### 3.2 Rede e Conectividade
- **VPC:** Padrão (`vpc-09ee59bf10910dc2b`).
- **Public Access:** Habilitado (IP público associado: `52.67.8.190`).
- **Security Group:** `default (sg-09bd286c887c5522b)`.
- **Regra de Entrada (Inbound Rule):**
  - `Tipo: MySQL/Aurora` | `Porta: 3306` | `Origem: 0.0.0.0/0` (Ativa e testada com sucesso).

---

## 4. Roteiro Operacional de Migração (Passo a Passo)

### Fase 1: Pré-Migração (Sem Impacto no Ambiente Atual)
1. Criar a instância Amazon RDS for MySQL no console AWS com os parâmetros da Seção 3.
2. Criar a base de dados inicial:
   ```sql
   CREATE DATABASE click_prestare CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```
3. Criar usuário restrito da aplicação (além do master):
   ```sql
   CREATE USER 'click_app'@'%' IDENTIFIED BY 'SUA_SENHA_FORTE';
   GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, INDEX, ALTER, REFERENCES ON click_prestare.* TO 'click_app'@'%';
   FLUSH PRIVILEGES;
   ```
4. Testar conexão local com Prisma:
   ```bash
   npx prisma db pull --url="mysql://click_app:SENHA@click-prestare-db-prod.xxxxxx.us-east-1.rds.amazonaws.com:3306/click_prestare"
   ```

---

### Fase 2: Execução da Migração (Janela de Manutenção)
*Recomenda-se realizar em horário de menor fluxo (ex.: 23h30 às 00h00).*

1. **Notificação de Manutenção:** Avisar portarias e usuários sobre instabilidade programada de 15 minutos.
2. **Congelamento de Escritas:** Pausar temporariamente o serviço da API no Railway para que nenhuma escrita ocorra durante o dump.
3. **Extração do Dump Completo do Railway:**
   ```bash
   mysqldump -h HOST_RAILWAY -u USUARIO_RAILWAY -pSENHA \
     --single-transaction \
     --quick \
     --routines \
     --triggers \
     --hex-blob \
     --default-character-set=utf8mb4 \
     NOME_BANCO_RAILWAY > backup_railway_final.sql
   ```
4. **Armazenamento de Segurança:** Subir imediatamente uma cópia intacta para o bucket S3 de segurança:
   ```bash
   aws s3 cp backup_railway_final.sql s3://seu-bucket-backups/backups-migracao/2026-09-17-railway-final.sql
   ```
5. **Carga dos Dados no Amazon RDS:**
   ```bash
   mysql -h click-prestare-db-prod.xxxxxx.us-east-1.rds.amazonaws.com -u click_admin -pSENHA click_prestare < backup_railway_final.sql
   ```

---

### Fase 3: Auditoria e Validação de Integridade
Antes de apontar a aplicação, executar checagens automáticas de contagem:

```sql
-- Comparar no Railway e na AWS:
SELECT 'condominios' AS tabela, COUNT(*) FROM condominios
UNION ALL
SELECT 'crm_admins', COUNT(*) FROM crm_admins
UNION ALL
SELECT 'users', COUNT(*) FROM users
UNION ALL
SELECT 'unidades', COUNT(*) FROM unidades
UNION ALL
SELECT 'visitas', COUNT(*) FROM visitas
UNION ALL
SELECT 'registros_acessos', COUNT(*) FROM registros_acessos;
```
*Critério de Sucesso:* A contagem deve bater 100% entre os dois bancos.

---

### Fase 4: Virada de Chave (Cutover)
1. **Atualização da Variável no Railway:**
   Alterar a variável de ambiente `DATABASE_URL` no painel da API no Railway:
   ```env
   DATABASE_URL="mysql://click_app:SENHA@click-prestare-db-prod.xxxxxx.us-east-1.rds.amazonaws.com:3306/click_prestare?sslaccept=strict"
   ```
2. **Reinício e Build:** O Railway reinicia o container automaticamente com a nova variável.
3. **Smoke Tests Operacionais:**
   - Efetuar login como Administrador do CRM.
   - Efetuar login no painel da Portaria Web.
   - Testar consulta de morador e unidade.
   - Testar registro de uma visita de teste.
   - Verificar logs do NestJS no Railway para confirmar ausência de erros de conexão/pool do Prisma.

---

## 5. Plano de Contingência e Rollback (Risco Zero)

Caso qualquer anormalidade grave ocorra durante a janela de migração (ex.: erro de importação, timeout de rede ou bloqueio de firewall):

1. **Reversão Imediata em < 2 Minutos:**
   * O banco de dados no Railway **não é apagado** nem alterado durante todo o processo.
   * Se houver qualquer falha, basta reverter a variável `DATABASE_URL` no Railway para o valor anterior do Railway.
   * A aplicação reinicia e volta a operar no estado anterior sem nenhuma perda de dados.
2. **Pós-Migração Segura:**
   * O banco antigo no Railway permanece ativo em modo de leitura por 7 dias como garantia adicional.
   * Somente após 7 dias de operação estável no RDS AWS o serviço de banco no Railway é desprovisionado.

---

## 6. Próximos Passos (Evolução Futura)

Quando o banco de dados estiver consolidado no AWS RDS, o próximo passo arquitetural opcional será migrar também a API para a AWS (via **AWS App Runner** ou **AWS ECS Fargate**). Isso permitirá:
- Eliminar o custo da API no Railway.
- Manter a API e o Banco dentro da mesma rede privada interna (sem necessidade de IP público para o RDS).
- Reduzir a latência das consultas para menos de 2 milissegundos.
