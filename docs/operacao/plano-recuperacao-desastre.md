# Plano de recuperação de desastre (DR)

Dono: o fundador. Escopo: API (EB), banco (RDS `database-1`), front-ends (Amplify), em `sa-east-1`.

## Objetivos

| Métrica | Meta | Base |
|---|---|---|
| RTO (tempo para voltar) | 4 horas | Restore do RDS + redeploy do EB, executados pelo fundador em dia útil |
| RPO (perda máxima de dados) | 24 horas | Backup automático diário do RDS. Com PITR a perda real tende a ~5 minutos dentro da retenção |

A meta de RPO de 24 h é o compromisso; o PITR melhora na prática, mas não se promete além disso.

## Estratégia: backup e restauração (mesma região)

- **Banco**: RDS `database-1` (db.t4g.micro, 20 GB, single-AZ) com backup automático diário, retenção de 7 dias, PITR, criptografia e deletion protection. Restauração cria nova instância (`runbooks.md`, seção 3).
- **Aplicação**: cada deploy gera a versão `api-<SHA>` no S3 do EB; o código está no GitHub. Reconstruir o ambiente = recriar o EB a partir da saved configuration `prestare-api-baseline-2026-11-04` e implantar a versão.
- **Front-ends**: o Amplify reconstrói a partir do GitHub.
- **Fotos**: bucket S3 `storage-click-dev` na conta 952520388262 (fora desta conta); depende dessa conta.
- **Agente local**: reenvia eventos offline com deduplicação, o que cobre lacunas curtas de indisponibilidade da API.

## Drift de configuração

- Configuração do EB preservada na saved configuration **`prestare-api-baseline-2026-11-04`** (criada em 04/11/2026 com `aws elasticbeanstalk create-configuration-template` a partir do ambiente). Após qualquer mudança de configuração do ambiente, criar nova saved configuration com a data no nome (`prestare-api-baseline-AAAA-MM-DD`) e registrar aqui; ela é a base para recriar o ambiente.
- Infra e procedimentos registrados no repo: `.github/workflows/`, `click-cond-web/.platform/`, `click-cond-web/scripts/migration/bundle-eb.mjs`, `docs/MIGRACAO_RAILWAY_PARA_AWS.md` e esta pasta.
- A comparação console x saved configuration é item da revisão mensal (`melhoria-continua.md`).

## Cenários e resposta

| Cenário | Resposta | Meta |
|---|---|---|
| Deploy ruim | Rollback de versão EB | < 30 min |
| Instância EB corrompida/perdida | Rebuild do ambiente + redeploy da última versão | < 2 h |
| Banco corrompido ou apagado por erro | Restore PITR/snapshot em nova instância e troca de endpoint | < 4 h |
| Falha de AZ/região | Sem réplica em outra região (single-AZ). Restaurar na mesma região quando recuperada e acionar AWS Support | Pode exceder o RTO; risco aceito |

## Riscos que afetam o DR

Single-AZ (EB e RDS); sem cópia de snapshot em outra região; fotos em bucket de outra conta com chave em quarentena; chave estática no env do EB. Multi-AZ e cópia entre regiões ficam como evolução condicionada a custo e à entrada de clientes reais (`prioridades-e-governanca.md`).

## Comunicação durante o desastre

Seguir `responsabilidades-e-escalonamento.md` (modelos de aviso e escalonamento ao AWS Support).

## Testes executados

### 2026-11-04 — restauração point-in-time do `database-1`

- **Procedimento:** `restore-db-instance-to-point-in-time` com `UseLatestRestorableTime` para a instância temporária `prestare-dr-teste` (db.t4g.micro, mesmo subnet group e security group), depois exclusão sem snapshot final.
- **Ponto restaurado:** 2026-11-04 19:13:25 UTC; a restauração começou às ~19:13 UTC. **Perda de dados efetiva: segundos** (PITR), dentro do RPO de 24 h.
- **Tempo até a instância ficar disponível:** ~16 min (19:13 → 19:29 UTC), dentro do RTO de 4 h. Para um failover real ainda contam a troca do `DATABASE_URL` e um deploy (ver `runbooks.md`).
- **Integridade:** contagem de linhas de todas as tabelas comparada com a produção: **78 tabelas e 983 linhas nos dois lados, nenhuma diferença**.
- **Limpeza:** instância temporária apagada no mesmo dia.
- **Próximo teste:** trimestral (próximo até 2027-02-04) e depois de mudanças de schema grandes.

