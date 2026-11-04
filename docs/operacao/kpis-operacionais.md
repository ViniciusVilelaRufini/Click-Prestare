# KPIs operacionais

Dono: o fundador. Revisão mensal (ver `melhoria-continua.md`). Painel CloudWatch `Prestare-Operacao`.

| KPI | Definição | Meta | Onde se mede |
|---|---|---|---|
| Disponibilidade | % de execuções do canary `prestare-health` (a cada 15 min, `/api/health` público) com sucesso no mês | >= 99,5% | CloudWatch Synthetics (`SuccessPercent`) |
| Latência p99 da API | p99 do tempo de resposta | < 1,5 s | CloudWatch (CloudFront/EB) e traces X-Ray |
| Taxa de 5xx | 5xx / total de requisições no CloudFront | < 1% (alarme); meta < 0,1% | Métrica `5xxErrorRate` do CloudFront |
| Frequência de deploy | Deploys bem-sucedidos por semana | >= 1/semana | Histórico do workflow `deploy-api.yml` no GitHub |
| Falhas de deploy | Deploys que falharam na verificação | < 10% | Histórico do GitHub Actions |
| MTTR | Do alarme/aviso até a normalização | < 4 h (alinhado ao RTO) | Registro de pós-incidente |
| Incidentes por mês | Eventos com impacto ao cliente | <= 2 | Registro de pós-incidente |

Observações:
- Não há SLA contratual publicado; as metas são internas.
- Disponibilidade e latência só têm dados depois que canary e X-Ray estiverem ativos.
- Números reais entram em "Linha de base" abaixo.

## Linha de base (teste de carga)

**2026-11-04, 19:15 UTC** — `autocannon -c 20 -d 60` contra `https://api.prestarecondominios.com.br/api/health` (via CloudFront), a partir de um único IP:

| Métrica | Resultado |
|---------|-----------|
| Requisições em 60 s | ~75 mil (média ~1.246 req/s) |
| Latência p50 / p97,5 / p99 / máx. | 14 ms / 28 ms / 41 ms / 260 ms |
| Respostas 2xx | 600 |
| Respostas não-2xx | 74.158, todas 429 (throttle por IP) |
| Respostas 5xx | 0 |

Leitura: o throttle por IP limita um único cliente a ~600 requisições/min e rejeita o excesso na hora com 429, sem derrubar a API. Um minuto depois do teste, o mesmo IP voltou a receber 200 (120 ms). Durante o teste o canary e os alarmes seguiram OK. Repetir o teste a cada trimestre e depois de qualquer mudança de instância ou de throttle.

