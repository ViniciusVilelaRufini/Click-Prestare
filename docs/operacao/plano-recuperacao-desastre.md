# Plano de recuperação de desastre (DR)

Dono: o fundador. Escopo: API (EB), banco (RDS `database-1`), front-ends (Amplify), em `sa-east-1`.

## Objetivos

| Métrica | Meta | Base |
|---|---|---|
| RTO (tempo para voltar) | 4 horas | Restore do RDS + redeploy do EB, executados pelo fundador em dia útil |
| RPO (perda máxima de dados) | 24 horas | Backup automático diário do RDS. Com PITR a perda real tende a ~5 minutos dentro da retenção |

A meta de RPO de 24 h é o compromisso; o PITR melhora na prática, mas não se promete além disso.

## Estratégia: backup e restauração (mesma região)

- **Banco**: backups automáticos diários do RDS (retenção mínima de 7 dias segundo `docs/MIGRACAO_RAILWAY_PARA_AWS.md`; confirmar o valor atual no console), PITR, criptografia e deletion protection. Restauração cria nova instância (`runbooks.md`, seção 3).
- **Aplicação**: cada deploy gera a versão `api-<SHA>` no S3 do EB; o código está no GitHub. Reconstruir o ambiente = recriar o EB a partir da saved configuration e implantar a versão.
- **Front-ends**: o Amplify reconstrói a partir do GitHub.
- **Fotos**: bucket S3 `storage-click-dev` na conta 952520388262 (fora desta conta); depende dessa conta.
- **Agente local**: reenvia eventos offline com deduplicação, o que cobre lacunas curtas de indisponibilidade da API.

## Drift de configuração

- Configuração do EB preservada em **saved configuration** (atualizar após qualquer mudança no ambiente; `aws elasticbeanstalk create-configuration-template` ou *Save configuration* no console) e restaurável em ambiente novo.
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

