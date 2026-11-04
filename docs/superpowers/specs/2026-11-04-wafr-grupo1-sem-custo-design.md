# WAFR — grupo 1 (sem custo relevante) — design

Data: 2026-11-04 · Autor: Claude (decisões próprias; o usuário pediu execução sem perguntas)

## Intenção

O FTR (selo "AWS Qualified Software") foi reprovado porque o relatório WAFR do workload
`5cd98629da19185f4c9fd144f19ff30e` tem riscos altos (HRIs) nos pilares Segurança,
Excelência Operacional e Confiabilidade. O usuário escolheu a opção (b): fazer agora tudo o
que não gera custo mensal relevante e decidir depois Multi-AZ, bucket novo e contas separadas.

Uma sondagem num workload temporário mapeou, para cada pergunta, quais práticas precisam
estar marcadas para a pergunta sair de HIGH (`.playwright-mcp/probe.txt`).

## Metas

- Implementar de verdade as práticas do grupo 1 e só então marcá-las no WAFR.
- Reduzir as 23 perguntas HIGH para as que dependem do grupo 2/3 (esperado: ~6).
- Gerar o PDF do WAFR atualizado, pronto para o "Resubmit" quando o resto estiver feito.

## Não-metas

- Multi-AZ (RDS + EB com ALB), sub-rede privada do RDS, KMS próprio, GuardDuty (custam).
- Bucket novo / chave `click_user` (usuário decidiu adiar).
- Separar contas (Organizations), IAM Identity Center, MFA root (dependem do usuário).
- Reenviar o FTR agora: com HRIs restantes ele seria reprovado de novo.

## Antimetas

- Marcar no WAFR uma prática que não existe. Toda marcação aponta para um artefato real
  (documento no repo, recurso na AWS, workflow, teste executado).
- Quebrar produção: nada remove variáveis do EB nem troca credenciais em uso sem verificação.

## Abordagens consideradas

1. **Só documentação** — rápido, mas alertas, rastreamento e teste de DR seriam promessas
   vazias; várias perguntas (observability, monitor, planning-for-recovery) continuariam HIGH.
2. **Documentação + recursos AWS baratos + CI (escolhida)** — docs em `docs/operacao/`,
   alarmes/painel/canary no CloudWatch, X-Ray na API, varredura de dependências e OIDC no CI,
   teste real de restauração do banco e um teste de carga controlado.
3. **Tudo de uma vez (incluindo grupo 2)** — fora do escopo escolhido pelo usuário.

## Decisões (todas minhas)

- **Docs** em `docs/operacao/` (pt-BR, um arquivo por tema), baseados no código real.
- **Alertas**: tópico SNS `prestare-alertas` com e-mail do usuário (ele confirma o e-mail);
  alarmes: saúde do EB, 5xx do CloudFront, CPU/armazenamento/conexões do RDS, status check
  da EC2, falha do canary. Painel CloudWatch `Prestare-Operacao`. Logs do EB enviados ao
  CloudWatch Logs (retenção 30 dias) com metric filter de erros.
- **Telemetria de experiência do usuário**: CloudWatch Synthetics canary a cada 15 min no
  `/api/health` e na página `/sobre` (~US$ 3/mês — aceito como "sem custo relevante").
- **Rastreamento distribuído**: AWS X-Ray na API (SDK no Express do Nest, subsegmentos HTTP
  e AWS SDK), daemon X-Ray ligado no EB via option setting (não é env var).
- **CI**: `npm audit --audit-level=high` (não bloqueante no 1º momento, relatório no job) e
  Dependabot semanal; deploy passa a usar OIDC (role com permissões só de EB/S3 do bundle),
  chaves estáticas do GitHub removidas depois do primeiro deploy verde.
- **Segredos no SSM: adiado.** Não tira `identities` de HIGH sozinho (depende de
  click_user e Identity Center) e mexe em segredos de produção; entra junto com o grupo 3.
- **DR**: RTO 4 h / RPO 24 h (backup automático diário do RDS + PITR de 5 min). Teste real:
  restaurar snapshot em instância temporária, conferir contagens de tabelas, apagar.
- **Teste de carga**: autocannon contra `/api/health` via CloudFront, 60 s, carga modesta,
  resultado registrado.
- **`ha_conn_private_networks`**: marcado como não aplicável (não há rede privada/on-prem;
  agentes falam com a API via HTTPS pública).

## Para o executor

Ordem livre entre docs, CI e AWS; a atualização do WAFR é a última etapa e só marca o que
foi entregue.
