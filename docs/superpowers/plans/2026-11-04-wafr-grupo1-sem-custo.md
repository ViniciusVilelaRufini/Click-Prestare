# WAFR grupo 1 (sem custo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar de verdade as práticas WAFR do grupo 1 (docs, observabilidade, CI, DR testado) e atualizar o workload WA só com o que foi entregue.

**Architecture:** Docs em `docs/operacao/`; observabilidade com CloudWatch (SNS, alarmes, painel, logs, canary) + X-Ray na API NestJS; CI com npm audit, Dependabot e OIDC; testes reais de restauração e carga registrados nos docs.

**Tech Stack:** NestJS (Nx, Jest), GitHub Actions, AWS CLI/boto3 no CloudShell, Elastic Beanstalk, RDS MySQL, CloudFront.

**Spec:** `docs/superpowers/specs/2026-11-04-wafr-grupo1-sem-custo-design.md`

## Global Constraints

- Nada é marcado no WAFR sem artefato real (doc, recurso AWS, workflow, teste executado).
- Não remover variáveis do EB; env do EB está no limite de 4096 chars — nenhuma env nova.
- Deploy = push em `master` e `main` (workflow `deploy-api.yml` do main publica).
- Toda dependência nova da API entra na lista explícita de `click-cond-web/scripts/migration/bundle-eb.mjs`.
- Docs em pt-BR, sem segredos (sem chaves, senhas, IPs pessoais).
- Região `sa-east-1`; conta `850401152034`; workload WA `5cd98629da19185f4c9fd144f19ff30e`.

## Review Focus

- X-Ray sem daemon (dev local, testes) → API sobe normalmente, sem erro nem log em loop (teste no Task 3).
- `npm audit` com vulnerabilidade alta → job reporta mas não bloqueia deploy (Task 4).
- Troca para OIDC → deploy só perde as chaves estáticas depois de um deploy verde com OIDC (Task 4/6).
- Restauração de teste do RDS → instância temporária sempre apagada, mesmo se a conferência falhar (Task 7).
- Teste de carga → limitado (≤ 20 conexões, 60 s) para não derrubar produção nem acionar o throttle de clientes reais (Task 7).

---

### Task 1: Docs de segurança (subagente)

**Files:** Create em `docs/operacao/`: `modelo-de-ameacas.md`, `objetivos-de-controle.md`, `plano-resposta-incidentes.md` (inclui playbooks: vazamento de chave, conta comprometida, indisponibilidade, vazamento de dados LGPD), `classificacao-e-retencao-de-dados.md`, `seguranca-de-aplicacao.md` (pentest trimestral + revisão do pipeline).

- [ ] Ler o código real (auth/JWT/MFA, perfis, isolamento por condomínio, expurgo LGPD em `storage.service.ts` e serviços que chamam `deleteUrl`, throttle, workflows) e escrever cada doc citando arquivos.
- [ ] Riscos conhecidos e não resolvidos (bucket público de outra conta, chave click_user, single-AZ) aparecem como riscos aceitos/pendentes, não como resolvidos.
- [ ] Commit `docs(operacao): documentos de seguranca do WAFR`.

### Task 2: Docs de operação e confiabilidade (subagente)

**Files:** Create em `docs/operacao/`: `responsabilidades-e-escalonamento.md` (dono de cada recurso/processo/atividade, patrocinador executivo, escalonamento, comunicação com clientes, pedidos de mudança/exceção), `prioridades-e-governanca.md` (clientes externos e internos, LGPD, governança), `kpis-operacionais.md`, `prontidao-operacional-orr.md`, `runbooks.md` (deploy, rollback, restaurar banco, rotacionar credencial, responder a cada alarme do Task 5), `plano-recuperacao-desastre.md` (RTO 4 h / RPO 24 h, estratégia backup & restore, drift de configuração via saved configuration do EB, seção "Testes executados" vazia para o Task 7), `cotas-e-limites.md`, `melhoria-continua.md` (feedback loops, pós-incidente).

- [ ] Escrever baseado no repo (workflows, `deploy-api.yml`, memórias do projeto citadas no brief), sem inventar processos que não existem.
- [ ] Commit `docs(operacao): operacao e confiabilidade do WAFR`.

### Task 3: X-Ray na API (subagente)

**Files:** Create `click-cond-web/apps/api/src/app/common/xray.ts` + spec; Modify `apps/api/src/main.ts`, `scripts/migration/bundle-eb.mjs`, config do EB no bundle (`.ebextensions/xray.config` com `aws:elasticbeanstalk:xray: XRayEnabled: true`).

**Interfaces:** Produces `instalarXRay(app: INestApplication): void` — liga segmentos por requisição (nome `prestare-api`) só quando `process.env.NODE_ENV === 'production'`; captura HTTP de saída e clientes AWS SDK v3; falha do daemon nunca derruba a requisição (context missing = log de nível baixo).

- [ ] Teste: `instalarXRay` em NODE_ENV=test não registra middleware e não lança.
- [ ] Teste: com NODE_ENV=production e daemon ausente, uma requisição ao app de teste responde 200.
- [ ] Implementar, rodar `npx jest` do arquivo e `npx tsc -p apps/api/tsconfig.app.json --noEmit`.
- [ ] Commit `feat(api): rastreamento distribuido com AWS X-Ray`.

### Task 4: CI — varredura de dependências e OIDC (subagente)

**Files:** Create `.github/dependabot.yml` (npm em `click-cond-web`, pub em `click-cond-app/click-cond-app`, github-actions; semanal, limite 5 PRs); Modify `.github/workflows/ci.yml` (job `audit`: `npm audit --audit-level=high` em `click-cond-web`, `continue-on-error: true`, resumo no `$GITHUB_STEP_SUMMARY`); Modify `.github/workflows/deploy-api.yml` (`permissions: id-token: write, contents: read`; `role-to-assume: arn:aws:iam::850401152034:role/github-deploy-prestare` no lugar das chaves).

- [ ] Validar YAML (`npx yaml-lint` ou `python -c "import yaml"`).
- [ ] Não commitar o deploy-api.yml até o Task 6 criar a role (o orquestrador commita junto).

### Task 5: Alertas, painel, logs e canary (orquestrador, CloudShell)

- [ ] SNS `prestare-alertas` + assinatura de e-mail do usuário.
- [ ] Alarmes: EB `EnvironmentHealth` (enhanced) ≥ 15; CloudFront `5xxErrorRate` > 5% (us-east-1); RDS `CPUUtilization` > 80%, `FreeStorageSpace` < 2 GB, `DatabaseConnections` alto; EC2 `StatusCheckFailed` ≥ 1; canary `SuccessPercent` < 100.
- [ ] Logs do EB para CloudWatch Logs (option settings `aws:elasticbeanstalk:cloudwatch:logs` StreamLogs=true, RetentionInDays=30) + metric filter de `ERROR` com alarme.
- [ ] Canary Synthetics `prestare-health` a cada 15 min em `/api/health` e `/sobre`.
- [ ] Painel `Prestare-Operacao` com as métricas acima.
- [ ] Verificar: `describe-alarms` lista todos em OK/INSUFFICIENT_DATA; canary com 1 execução PASSED.

### Task 6: Role OIDC do GitHub (orquestrador, CloudShell)

- [ ] Provedor OIDC `token.actions.githubusercontent.com` + role `github-deploy-prestare` (trust no repo, branch main/master) com permissões de EB e S3 do bucket de versões.
- [ ] Commitar Task 4, push master+main, conferir deploy verde com OIDC e o passo "Verify deployed version".

### Task 7: Teste de restauração e de carga (orquestrador)

- [ ] Restaurar o snapshot automático mais recente do RDS em `prestare-dr-teste` (db.t3.micro, sem acesso público), medir tempo, conferir contagem de tabelas principais, apagar a instância (try/finally).
- [ ] autocannon 20 conexões × 60 s em `https://api.prestarecondominios.com.br/api/health`; registrar p50/p99/erros.
- [ ] Registrar os dois resultados em `plano-recuperacao-desastre.md` e `kpis-operacionais.md`; commit.

### Task 8: Atualizar o WAFR (orquestrador)

- [ ] Para cada pergunta, marcar só práticas com artefato; notas citam o arquivo/recurso.
- [ ] `rel_planning_network_topology_ha_conn_private_networks` como NOT_APPLICABLE (ARCHITECTURE_CONSTRAINTS: sem rede privada/on-prem).
- [ ] Gerar PDF, baixar para `.playwright-mcp/prestare-wafr-v2.pdf`, listar as perguntas que seguem HIGH e o que falta para cada uma (grupo 2/3).
