# Bateria de testes de produção — 25/11/2026

Conta AWS 850401152034 (sa-east-1), pelo CloudShell, e da internet pública. Tudo só leitura, exceto o canary (recriado) e o deploy das correções abaixo. Scripts versionados em `scripts/ops/bateria-producao/` (rodar `bash bateria.sh --banco` depois de cada deploy).

## O que foi testado

| Frente | Como | Resultado |
|---|---|---|
| API caixa-preta | health, latência (20 req), HSTS/nosniff/X-Frame, x-powered-by, CORS (origem estranha e oficial), 10 rotas protegidas sem token, JWT `alg=none` e assinatura falsa, 404 sem stack, login inválido/SQLi/objeto no campo/JSON malformado/body array, corpo de 3 MB, throttle do login (12 tentativas), recuperação de senha sem enumeração, agente com token falso, TRACE, http→https, TLS (validade e TLS 1.1) | 1 bug (corpo grande = 500) |
| Rotas públicas (64) | 531 requisições com token falso, corpo vazio/array/string/null, tipos errados, string de 3000 chars, path traversal, XSS no path, XXE no XML, prototype pollution no urlencoded | 0 respostas 5xx |
| Infra | EB (saúde, instâncias, tamanho das envs), RDS (Multi-AZ, criptografia, proteção contra exclusão, não público, backup, CPU, disco, conexões), alarmes, SNS, canary | canary parado há 13 dias |
| Logs | 5xx e erros fora do HTTP em 7 dias (CloudWatch Logs Insights) | só os 500 provocados pelo teste; ruído do tickFantasmas do terminal de teste |
| Portal (navegador) | 24 páginas e links públicos abertos direto (landing, login, convite, passe, entrega, redefinir senha, política, exclusão de conta, telas internas com F5), console e recursos com erro | links de passe e entrega quebrados |
| Banco | 40 checagens de integridade (duplicatas de e-mail/CPF/login, senhas fora de bcrypt, dados cruzando condomínio, QR ativo órfão, PIN repetido, reservas sobrepostas, chaves e índices, engine/charset, conexões, sql_mode) | 2 achados de dado + 2 de configuração |

## Corrigido

1. **Corpo acima do limite respondia 500 em vez de 413** (`all-exceptions.filter.ts`). O erro do body-parser (padrão http-errors, `status` 4xx + `expose`) não é `HttpException` e caía no 500. Agora mantém o status e a mensagem ("Corpo da requisição muito grande."); 5xx e erros não expostos seguem 500 genérico. 4 testes novos.
2. **Feed de notificações mostrava pedido de autorização vencido** (`mobile-auth.service.ts`, `getNotificacoes`). Pedidos de 14 e 15/11 sem resposta continuavam como "aguarda sua autorização na portaria". O feed agora aplica o mesmo prazo de 10 min (`AUTORIZACAO_EXPIRACAO_MS`) da caixa de pendentes e do autorizar. 2 testes novos.
3. **Canary `prestare-health` parado desde 12/11 e alarme `prestare-canary-falha` em ALARM desde 09/11.** O passo `site-sobre` exigia 200 em `/sobre`, que passou a responder 301 para `/sobre/`. Recriado (runtime `syn-nodejs-puppeteer-19.1`), seguindo até 3 redirecionamentos; código agora versionado em `scripts/ops/canary/`. Primeira execução PASSED e alarme voltou a OK.

4. **Links `/passe/<token>` e `/entrega/<token>` abriam a página 404 do Amplify** (link do passe do visitante e QR do entregador no portão). A regra SPA do Amplify listava as rotas do Angular sem essas duas. O `docs/operacao/amplify-regras.json` já as previa, mas nunca foi aplicado, e ainda recusava ponto em `passe/<token>` (o token é `<id36>.<hmac>`): aplicado só a regra SPA corrigida (backup em `~/testes/amplify-rules-backup-*.json` no CloudShell), conferido no navegador que passe, entrega, convite, dashboard, login, landing e política abrem e que rota inexistente segue 404. Arquivo do repositório igualado à produção.

**Publicação**: 1 e 2 estão no branch `fix/testes-producao-2026-11-25` (suíte da API 6133/6133), sem push — o push para master/main foi barrado pela proteção do modo automático e fica para o dono liberar. 3 e 4 são configuração da AWS e já estão no ar.

## Estado observado

- Agente local do condomínio de teste atualizou sozinho para 2026.11.24 (estado "em dia", poll a cada minuto).
- O terminal facial de teste (Intelbras, 192.168.3.175) está offline para o agente desde 04/11: o agente roda, mas não alcança o aparelho na rede local. É a origem dos avisos horários de `tickFantasmas device 1` no log.
- Últimos 7 dias: nenhum 5xx real na API (só os 2 provocados pela bateria).

## Para decidir (não mexi)

- **`noindex` faltando em `/passe/*` e `/entrega/*`** (o `amplify-cabecalhos.yml` prevê, produção não manda; `/convite/*` manda). Os cabeçalhos não vêm do `customHeaders` do app Amplify nem do `amplify.yml`; conferir onde estão (provavelmente a política de resposta do CloudFront) e alinhar. Risco baixo: os tokens não são públicos.

- **`max_connections` do RDS = 60, pico usado = 49.** Cada processo da API abre até 25 (DATABASE_URL); num deploy com dois processos o pool chega perto do teto. Opções: subir `max_connections` no parameter group ou baixar `connection_limit` para ~20.
- **`sql_mode` = `NO_ENGINE_SUBSTITUTION` (sem `STRICT_TRANS_TABLES`).** O MySQL trunca texto longo e aceita data inválida em silêncio. Ligar o modo estrito é o certo, mas pode quebrar gravações que hoje passam truncadas: testar antes numa cópia.
- **1 instância no EB e RDS Single-AZ** (já conhecido): cada deploy derruba algumas requisições.
- **Pilha `voltz-platform` nesta conta** (5 alarmes e o tópico `voltz-platform-AlertTopic` sem assinante). É de outro projeto; confirmar se deve estar aqui.
- **Dados de teste incoerentes**: 7 moradores com unidade inexistente (semente de 21/09, ids 1–5, 31 e 39) e 39 moradores sem registro de consentimento de privacidade (provavelmente nunca abriram o app). Sem dados reais ainda; limpar antes do primeiro cliente.

## Sem achado

Cabeçalhos de segurança, CORS, autenticação (JWT forjado = 401), throttle, TLS, RDS privado e criptografado, backups, alarmes da Prestare com e-mail confirmado, nenhuma duplicata de conta, nenhum dado cruzando condomínio, nenhuma tabela sem chave primária ou FK sem índice.
