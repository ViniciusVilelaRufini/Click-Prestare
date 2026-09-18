# Plano de Execução: Migração 100% dos Dados do Railway para AWS RDS MySQL

Este plano detalha as tarefas atômicas para extrair, carregar, auditar e virar a chave do banco de dados do Railway para o **Amazon RDS MySQL (`database-1`)** em São Paulo (`sa-east-1`).

- **Spec de Referência:** `docs/superpowers/specs/2026-09-17-migracao-banco-dados-aws-rds-design.md`
- **Origem (Railway):** `turntable.proxy.rlwy.net:54654` (DB: `railway`)
- **Destino (AWS RDS):** `database-1.crq2ie2ww3dh.sa-east-1.rds.amazonaws.com:3306` (DB: `railway` ou `click_prestare`)

---

## Global Constraints
1. **Zero perda de dados:** Todos os registros e tabelas devem ser migrados com integridade referencial mantida.
2. **Cópia de segurança intacta:** Manter arquivo `.sql` do dump original preservado antes de qualquer tentativa de carga.
3. **Validação automatizada:** Não considerar concluído sem um script comparativo de contagem de linhas entre as tabelas de origem e destino.
4. **Sem interrupção destrutiva no Railway:** O banco do Railway não é apagado; serve como fallback imediato de rollback.

---

## Tarefas Executadas e Concluídas

### [CONCLUÍDO] Tarefa 1: Pré-voo e Inicialização do Schema no AWS RDS
- Conexão autenticada com sucesso no RDS (`database-1.crq2ie2ww3dh.sa-east-1.rds.amazonaws.com:3306`).
- Banco `click_prestare` criado com charset `utf8mb4` e collation `utf8mb4_unicode_ci`.

### [CONCLUÍDO] Tarefa 2: Extração Completa do Railway (Dump Estruturado)
- Extraídas todas as 63 tabelas e 4.369 registros da base do Railway.
- Arquivo de backup seguro gravado em `backups/railway_dump_final.sql`.

### [CONCLUÍDO] Tarefa 3: Carga e Restauração no AWS RDS
- Script de migração direta em lotes (`scripts/migration/sync-railway-to-aws.mjs`) executado com sucesso.
- Todas as 63 tabelas recriadas e todos os registros inseridos.

### [CONCLUÍDO] Tarefa 4: Auditoria e Validação Cruzada (Row-by-Row Check)
- Auditoria automatizada executada:
  - Total de Tabelas: **63 / 63**
  - Registros na Origem (Railway): **4.369**
  - Registros no Destino (AWS RDS): **4.369**
  - Divergências: **0 (Zero)**
  - **Paridade: 100.0%**

### [CONCLUÍDO] Tarefa 5: Atualização de Variáveis e Teste Operacional
- `click-cond-web/.env` atualizado com a nova `DATABASE_URL` do AWS RDS.
- Fallback do Railway preservado como comentário para rollback imediato se necessário.
- Prisma Client testado e validado com sucesso (consultas a condomínios, usuários e biometrias retornando dados reais da AWS).
