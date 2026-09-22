# Task 4 — Bloqueio de SSRF no facial

## Implementação

- `toDataUrl` e `fetchPhotoAsBase64` agora usam uma única rotina de download confiável.
- Apenas URLs HTTPS dos hostnames configurados em `R2_PUBLIC_URL` ou `AWS_S3_BASE_URL` são aceitas.
- URLs com credenciais, hosts externos, IPs privados/link-local/reservados e DNS que resolve para rede interna são recusados antes da requisição HTTP.
- O agente HTTPS repete a validação de DNS durante a conexão, para reduzir risco de rebinding.
- Redirecionamentos estão desativados; há timeout de 15 s e limite de 5 MiB para corpo/resposta.
- Apenas JPEG, PNG e WebP recebidos por HTTP são convertidos. Data URLs legadas permanecem inalteradas.

## Testes

- RED observado: `facial.ssrF.spec.ts` falhou antes da implementação porque Axios era chamado para URLs internas/externas, sem limites, e `text/html` era aceito.
- PASS: `npm.cmd exec -- nx test @org/api --testPathPatterns=facial.ssrF.spec.ts` — 1 suíte, 9 testes.
- PASS: `npm.cmd exec -- nx typecheck @org/api`.
- A suíte completa `npm.cmd exec -- nx test @org/api` foi executada: 152 suítes / 1245 testes passaram; falha preexistente em `src/app/common/storage/storage.controller.spec.ts`, que espera uma exceção síncrona mas `StorageController.read()` lança `ForbiddenException`.

## Escopo

Nenhuma configuração ou recurso AWS foi alterado.
