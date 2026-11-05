# Plano de recuperação de desastre (DR)

Dono: o fundador. Escopo: API (EB), banco (RDS `database-1`), front-ends (Amplify), em `sa-east-1`. Atualizado em 2026-11-04: API balanceada em duas zonas e banco Multi-AZ.

## Objetivos

| Métrica | Meta | Base |
|---|---|---|
| RTO, falha de uma zona (AZ) | Minutos, sem ação humana | RDS Multi-AZ promove o standby (em geral 1 a 2 min) e o ALB/ASG seguem com a instância da outra zona |
| RPO, falha de uma zona | ~0 | Replicação síncrona do Multi-AZ |
| RTO, corrupção/apagão lógico ou perda da região | 4 horas | Restore PITR/snapshot do RDS + redeploy do EB, executados pelo fundador em dia útil |
| RPO, corrupção/apagão lógico | 24 horas (compromisso) | Backup automático diário (7 dias) com PITR; na prática a perda tende a segundos/minutos dentro da retenção |

O Multi-AZ protege contra falha de infraestrutura de uma zona, não contra erro lógico (um `DELETE` errado replica para o standby): para isso valem backup e PITR. Falha da região inteira continua sem cobertura automática (sem cópia entre regiões).

## Estratégia: backup e restauração (mesma região)

- **Banco**: RDS `database-1` (db.t4g.micro, 20 GB, **Multi-AZ**) em subnets privadas sem rota para a internet (subnet group `prestare-db-privado`), não público, com backup automático diário, retenção de 7 dias, PITR, criptografia e deletion protection. Foi migrado em 2026-11-04 por restauração PITR + renomeação (~21 min de restore, alguns minutos de indisponibilidade na troca). A instância antiga está parada como `database-1-antigo`, só como fallback; decidir a exclusão antes que a AWS a religue (7 dias). Restauração cria nova instância, **no subnet group `prestare-db-privado`** (`runbooks.md`, seção 3).
- **API**: ambiente EB balanceado (ALB + Auto Scaling group 2 a 4 instâncias em sa-east-1b e sa-east-1c). Tarefas agendadas rodam uma vez por cluster via trava no MySQL (`GET_LOCK`), e o estado compartilhado (lockout de login, comandos do agente, estado dos dispositivos) fica no banco, então perder uma instância não perde estado.
- **Aplicação**: cada deploy gera a versão `api-<SHA>` no S3 do EB; o código está no GitHub. Reconstruir o ambiente = recriar o EB a partir da saved configuration `prestare-api-baseline-2026-11-04` e implantar a versão.
- **Front-ends**: o Amplify reconstrói a partir do GitHub.
- **Arquivos/fotos**: bucket privado `prestare-arquivos-850401152034` (sa-east-1, SSE-KMS `alias/prestare-dados`, versionamento ligado, noncurrent expira em 90 dias), entregue por URL assinada de até 1 h. Os 8 objetos que existiam foram migrados do bucket antigo `storage-click-dev` (outra conta, intocado); 12 mídias de teste do WhatsApp não foram recuperáveis. O versionamento cobre apagão acidental; não há cópia entre regiões.
- **Segredos**: SSM Parameter Store `/prestare/api/*` (SecureString, KMS `alias/prestare-dados`). Para reconstruir o ambiente, os parâmetros precisam existir na conta; o valor não está no repo.
- **Agente local**: reenvia eventos offline com deduplicação, o que cobre lacunas curtas de indisponibilidade da API.

## Drift de configuração

- Configuração do EB preservada na saved configuration **`prestare-api-baseline-2026-11-04`** (criada em 04/11/2026 com `aws elasticbeanstalk create-configuration-template` a partir do ambiente). **A baseline `prestare-api-baseline-2026-11-04` é anterior ao ALB/ASG (era instância única): criar uma nova saved configuration com a topologia atual (ALB, ASG 2 a 4, health check `/api/health`, stickiness, rolling) antes de depender dela para recriar o ambiente.** Após qualquer mudança de configuração do ambiente, criar nova saved configuration com a data no nome (`prestare-api-baseline-AAAA-MM-DD`) e registrar aqui; ela é a base para recriar o ambiente.
- Infra e procedimentos registrados no repo: `.github/workflows/`, `click-cond-web/.platform/`, `click-cond-web/scripts/migration/bundle-eb.mjs`, `docs/MIGRACAO_RAILWAY_PARA_AWS.md` e esta pasta.
- A comparação console x saved configuration é item da revisão mensal (`melhoria-continua.md`).

## Cenários e resposta

| Cenário | Resposta | Meta |
|---|---|---|
| Deploy ruim | Rollback de versão EB (rolling, sem queda) | < 30 min |
| Instância EB corrompida/perdida | O Auto Scaling group substitui; o ALB já atende pela outra. Rebuild só se o ambiente inteiro estiver ruim | Automático (minutos) |
| Falha de uma AZ | RDS promove o standby; ASG segue com a instância da outra zona e recompõe a capacidade | Minutos, sem ação |
| Banco corrompido ou apagado por erro | Restore PITR/snapshot em nova instância no `prestare-db-privado` e troca de endpoint (renomear ou atualizar `DATABASE_URL` no SSM) | < 4 h |
| Falha da região | Sem réplica em outra região. Restaurar na mesma região quando recuperada e acionar AWS Support | Pode exceder o RTO; risco aceito |

## Riscos que afetam o DR

Sem cópia de snapshot nem de arquivos em outra região (falha regional não tem cobertura); conta AWS compartilhada com o projeto Volti (cargas não separadas em contas distintas: um erro ou comprometimento na conta afeta tudo; decisão do fundador pendente); instância `database-1-antigo` parada e a excluir. Cópia entre regiões fica como evolução condicionada a custo e à entrada de clientes reais (`prioridades-e-governanca.md`).

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

### 2026-11-04 — migração do banco para Multi-AZ privado

Não foi um teste, mas exercitou o procedimento de restore real: PITR de `database-1` para uma instância Multi-AZ no subnet group `prestare-db-privado` (~21 min), renomeação (`database-1` -> `database-1-antigo`, nova -> `database-1`) com alguns minutos de indisponibilidade, mesmo endpoint. Serve de referência de tempo: restore ~21 min com o banco atual.
