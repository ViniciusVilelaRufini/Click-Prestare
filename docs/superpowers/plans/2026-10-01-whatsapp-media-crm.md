# CRM WhatsApp — mídias e áudio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Enviar imagem, vídeo e documento pelo CRM e renderizar mídia recebida, com player de áudio.

**Architecture:** A API valida multipart e usa a Cloud API da Meta. Mídias recebidas são baixadas antes de expirar e guardadas em S3 privado; o CRM recebe-as por rota autenticada. Metadados ficam em `crm_whatsapp_mensagens`.

**Tech Stack:** Angular 21, NestJS 11, Prisma/MySQL, AWS S3 SDK, Cloud API do WhatsApp, Jest/Nx.

**Spec:** `docs/superpowers/specs/2026-10-01-whatsapp-media-crm-design.md`

## Global Constraints

- Preserve texto, respostas rápidas, automações e janela WhatsApp de 24 horas.
- Nunca exponha token Meta, credencial S3 ou URL permanente do bucket.
- Use `CrmAdminGuard`; valide MIME e tamanho antes de Meta/S3.
- O webhook permanece idempotente por `wamid` e tolera falha de importação.
- SQL fica em `click-cond-web/prisma/sql/` e é autorizado no executor e workflow de migração.

## Review Focus

- MIME falso é rejeitado antes da Meta/S3.
- `wamid` repetido não cria segunda mensagem/objeto.
- Áudio sem arquivo é mostrado como indisponível, sem player quebrado.
- Sem sessão CRM não há bytes nem URL de mídia.
- Falha Graph/S3 registra falha sem apagar texto/anexo do operador.

### Task 1: Dados e armazenamento privado

**Files:** `prisma/schema.prisma`, novo SQL `prisma/sql/2026-10-01-crm-whatsapp-media.sql`, `scripts/run-sql-migration.mjs`, workflow de migração, novo `whatsapp-media.service.ts` e seu spec, `whatsapp.module.ts`.

**Interfaces:** `WhatsAppMediaService.guardarEntrada({ wamid, tipo, mediaId })` retorna `{ chave, mime, nome, tamanho, status }`; `abrir(chave)` retorna stream e metadados.

- [x] Escrever testes falhando para áudio inbound persistido sob chave `whatsapp/<wamid>/<uuid>` e para MIME `application/x-msdownload` rejeitado antes de Graph/S3.
- [x] Executar `npx nx test @org/api --skip-nx-cache -- whatsapp-media.service.spec.ts --runInBand` e confirmar RED.
- [x] Adicionar `media_chave`, `media_mime`, `media_nome`, `media_tamanho`, `media_status` nulos a `Crm_WhatsApp_Mensagens`, SQL idempotente e allowlists.
- [x] Implementar serviço injetável, allowlist MIME/categoria, limites configuráveis, S3 privado e streams sem URL pública.
- [x] Executar `npx prisma generate --schema prisma/schema.prisma`, teste focado e `npx nx run @org/api:typecheck`; confirmar GREEN.
- [x] Commit: `feat(whatsapp): armazenar mídias privadas`.

### Task 2: Graph API, webhook e rotas

**Files:** `whatsapp-puro.ts/spec`, `whatsapp-graph.client.ts/spec`, `whatsapp-inbox.service.ts/spec`, `whatsapp-crm.controller.ts`, novo controller spec.

**Interfaces:** estender `EntradaWa` com `mediaId`, `mime`, `nome`; criar `enviarMidia({ para, tipo, arquivo, legenda? })`; expor `POST /crm/whatsapp/conversas/:id/midias` e `GET /crm/whatsapp/midias/:mensagemId`.

- [x] Escrever testes falhando: webhook de áudio extrai `mediaId`; imagem outbound chama `enviarMidia`; download sem autenticação retorna 401.
- [x] Executar `npx nx test @org/api --skip-nx-cache -- whatsapp-puro.spec.ts whatsapp-inbox.service.spec.ts whatsapp-crm.controller.spec.ts --runInBand` e confirmar RED.
- [x] Implementar upload multipart Graph seguido da mensagem `image`, `video` ou `document`; preservar metadados inbound e chamar o serviço da tarefa 1 após persistir a mensagem.
- [x] Implementar interceptor multipart, validação da janela, stream autenticado com MIME/Range e mensagem `falhou` em erro outbound.
- [x] Executar specs Graph/webhook/inbox/controller e typecheck; confirmar GREEN, incluindo `wamid` duplicado e acesso sem sessão.
- [x] Commit: `feat(whatsapp): enviar e receber mídias`.

### Task 3: Anexos e reprodução no CRM

**Files:** `crm-web/src/app/crm/whatsapp.service.ts`, `tabs/crm-whatsapp.component.ts/html`, novo component spec.

**Interfaces:** criar `WhatsappApi.enviarMidia(id, arquivo, legenda)` e ampliar `Mensagem` com os metadados de mídia.

- [x] Escrever testes falhando para `<audio controls>` em áudio pronto e PDF selecionado enviado via `enviarMidia(1, filePdf, '')`.
- [x] Executar `npx nx test crm-web --skip-nx-cache -- crm-whatsapp.component.spec.ts --runInBand` e confirmar RED.
- [x] Implementar botão de anexo, input acessível, chip com remoção, upload/erro; preservar respostas rápidas, textarea, Enter e aviso de janela.
- [x] Renderizar miniatura de imagem, áudio nativo, vídeo nativo, cartão baixável de documento e estado indisponível.
- [x] Executar spec do componente e `npm run build:crm`; confirmar GREEN.
- [x] Commit: `feat(crm): anexar e reproduzir mídias WhatsApp`.

### Task 4: Configuração e verificação integrada

**Files:** `click-cond-web/.env.example`.

- [x] Escrever teste falhando: sem configuração S3, mídia inbound retorna `status: 'indisponivel'` sem lançar no webhook.
- [x] Executar o spec de mídia e confirmar RED; documentar apenas `WA_MEDIA_BUCKET`, região/credenciais de runtime, sem segredos; implementar o estado seguro; confirmar GREEN.
- [x] Executar `npx nx test @org/api --skip-nx-cache -- --runInBand`, `npx nx test crm-web --skip-nx-cache -- --runInBand`, typecheck, build CRM e `git diff --check`.
- [x] Commit: `docs: configurar mídias privadas do WhatsApp`.
