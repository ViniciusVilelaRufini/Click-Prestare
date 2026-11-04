# Cotas e limites

Dono: o fundador. Revisão mensal junto com os KPIs. Valores marcados "confirmar" dependem do console no momento da revisão.

| Recurso | Limite / restrição | Efeito | Como é monitorado |
|---|---|---|---|
| Variáveis de ambiente do EB | 4096 caracteres no total (CloudFormation) | `update-environment` falha em silêncio e o ambiente fica na versão antiga | Passo "Verify deployed version" do `deploy-api.yml`; nunca usar `--option-settings` |
| EC2 do EB | t3.small, instância única (2 vCPU com crédito de CPU, 2 GB) | Créditos esgotam sob carga contínua; sem redundância | `prestare-eb-saude` e `prestare-ec2-statuscheck` |
| RDS `database-1` | db.t4g.micro (2 vCPU com crédito de CPU, 1 GB), 20 GB, single-AZ; `max_connections` pequeno por causa da memória | Falta de espaço, de crédito de CPU ou de conexões derruba a API | `prestare-rds-armazenamento`, `prestare-rds-cpu`, `prestare-rds-conexoes` (mais de 50) |
| Pool de conexões da API | Definido na configuração do driver (confirmar) | Pode esgotar antes do RDS | Alarme de conexões; filtro ERROR |
| Throttle da API | `short` 20 req/s e `medium` 600 req/min por IP (`click-cond-web/apps/api/src/app/common/throttle/throttlers.ts`, `ThrottlerGuard` global). Teste de carga: a partir de ~600 req/min de um único IP a API respondeu 429 | HTTP 429 acima do limite. Atenção: a portaria-web chega via Amplify e vários clientes podem compartilhar o IP de saída | Ocorrências de 429 nos logs |
| Timeouts de saída | Assistente IA 20 s (`chat-ia.service.ts`); chamadas do módulo facial 15 s (`facial.service.ts`); download de imagem de encomenda 5 s (`encomendas.service.ts`); credenciais da instância 2 s (`aws-credenciais.util.ts`) | Terceiro lento não prende a API além desses tempos | Filtro ERROR |
| Amazon Bedrock | Tokens e requisições por minuto de Claude Sonnet 4.6 e Titan na região (cota padrão da conta; confirmar em Service Quotas) | Assistente IA sofre throttling; Gemini é contingência | Métricas Bedrock (`InvocationThrottles`), filtro ERROR |
| CloudFront | Cotas padrão de requisições e distribuições da conta | Improvável no volume atual | Alarme de 5xx |
| Logs do EB | Retenção de 30 dias no CloudWatch Logs | Histórico mais antigo é descartado | Configuração do grupo de logs |
| E-mail (SMTP) | Limite diário do provedor (confirmar) | Código MFA e avisos não chegam | Erros de envio no filtro ERROR |
| Conta AWS compartilhada | Cotas de serviço divididas com recursos do projeto Volti | Consumo de um afeta o outro | Service Quotas na revisão mensal |

## Quando revisar

Mensalmente e antes de lançamento relevante (`prontidao-operacional-orr.md`). Ao chegar a 70% de qualquer cota, pedir aumento no Service Quotas ou abrir tarefa para reduzir consumo.
