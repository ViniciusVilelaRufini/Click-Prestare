# Delivery — Controle de Entregadores Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o módulo Delivery para avisos de entrega, controle de portaria e cadastro de motoboys no portal web e no app.

**Architecture:** Criar um módulo Nest/Prisma independente de Encomendas que preserva atendimentos e eventos de auditoria. Expor clientes tipados no Angular e Flutter, com uma fila operacional no portal e avisos/status no aplicativo. Manter todo acesso limitado ao condomínio ativo e ao vínculo do morador com a unidade.

**Tech Stack:** NestJS, Prisma/MySQL, Angular 21/Nx/Jest e Flutter/Dart.

**Spec:** `docs/superpowers/specs/2026-09-27-delivery-controle-entregadores-design.md`

## Global Constraints

- O módulo não implementa parceiros, cardápio, pedidos comerciais ou pagamento.
- Dados e ações são isolados pelo condomínio ativo; o servidor valida a unidade do morador.
- Motoboy bloqueado não pode ser autorizado; cancelamento, recusa e bloqueio exigem motivo.
- Eventos de estado são imutáveis e registram autor, data/hora e observação.
- Moradores não visualizam documentos, bloqueios ou histórico de terceiros.

## Review Focus

- Tentativa de morador criar aviso para apartamento sem vínculo deve retornar acesso negado.
- Tentativa de avançar de um estado terminal deve retornar erro de transição inválida.
- Entregador bloqueado deve aparecer na busca, mas impedir a autorização.
- Placa normalizada duplicada no mesmo condomínio deve ser recusada sem afetar outro condomínio.
- Falha de API no app/web não pode apresentar atualização de status como confirmada.

---

### Task 1: Modelo, migração e API de Delivery

**Files:**
- Modify: `click-cond-web/prisma/schema.prisma`, `click-cond-web/apps/api/src/app/app.module.ts`
- Create: `click-cond-web/apps/api/src/app/delivery/*`
- Test: `click-cond-web/apps/api/src/app/delivery/delivery.service.spec.ts`

**Interfaces:**
- Produces: `GET/POST/PATCH /delivery`, `GET/POST/PATCH /delivery/entregadores` e contratos de `status`, `motivo`, `id_apartamento`, `id_entregador`.
- Consumes: autenticação, condomínio ativo, moradores, apartamentos e notificações existentes.

- [ ] **Step 1: Escrever testes Nest que falham**
  Cobrir criação de aviso restrita ao morador/unidade, transição AGENDADA→CHEGOU→AUTORIZADA→CONCLUIDA, recusa sem motivo, e autorização com entregador bloqueado.
- [ ] **Step 2: Rodar os testes focados e confirmar falha pela ausência do módulo**
  Run: `npm exec nx test api --testPathPattern=delivery.service.spec.ts`
- [ ] **Step 3: Criar schema Prisma e migration**
  Criar entidades de entregador, veículo, atendimento e evento, com índices por condomínio/status/criação e unicidade condominial para placa informada.
- [ ] **Step 4: Implementar módulo, DTOs, controller e service mínimos**
  Aplicar autorização, máquina de estados, auditoria e notificações nos pontos de chegada, autorização e conclusão.
- [ ] **Step 5: Rodar testes focados e suite API**
  Run: `npm exec nx test api --testPathPattern=delivery` e `npm exec nx test api`.
- [ ] **Step 6: Commit**
  `git add click-cond-web/prisma click-cond-web/apps/api/src/app && git commit -m "feat(delivery): adicionar API de atendimentos e entregadores"`

### Task 2: Área Delivery no portal web

**Files:**
- Modify: `click-cond-web/apps/portaria-web/src/app/app.routes.ts`, `click-cond-web/apps/portaria-web/src/app/shell/sidebar.component.ts`
- Create: `click-cond-web/apps/portaria-web/src/app/delivery/*`
- Test: `click-cond-web/apps/portaria-web/src/app/delivery/delivery-page.component.spec.ts`

**Interfaces:**
- Consumes: API de Task 1 e padrões visuais de `encomendas` e `visitantes`.
- Produces: rota `/delivery`, fila, detalhes de atendimento e gestão de entregadores.

- [ ] **Step 1: Escrever testes Angular que falham**
  Cobrir entrada de menu/rota, renderização da fila, filtro por placa/unidade e botão de autorização indisponível para bloqueado.
- [ ] **Step 2: Rodar teste e confirmar falha**
  Run: `npm exec nx test portaria-web --testPathPattern=delivery-page.component.spec.ts`
- [ ] **Step 3: Implementar serviço, modelos e página Delivery**
  Criar fila por status, busca/filtros, painel de detalhes com linha do tempo e ações condicionadas à máquina de estados.
- [ ] **Step 4: Implementar cadastro e bloqueio de motoboys**
  Permitir busca, criação no contexto do atendimento, edição e motivo obrigatório de bloqueio/recusa.
- [ ] **Step 5: Rodar testes focados e suite do portal**
  Run: `npm exec nx test portaria-web --testPathPattern=delivery` e `npm exec nx test portaria-web`.
- [ ] **Step 6: Commit**
  `git add click-cond-web/apps/portaria-web && git commit -m "feat(delivery): adicionar fila e cadastro de motoboys no portal"`

### Task 3: Delivery no aplicativo Flutter

**Files:**
- Modify: `click-cond-app/click-cond-app/lib/router.dart` e a navegação existente do morador.
- Create: `click-cond-app/click-cond-app/lib/models/delivery_model.dart`, `click-cond-app/click-cond-app/lib/controllers/controller_delivery.dart`, `click-cond-app/click-cond-app/lib/pages/shared/delivery/*`
- Test: `click-cond-app/click-cond-app/test/delivery/*_test.dart`

**Interfaces:**
- Consumes: endpoints e estados da Task 1, estilos e API client do aplicativo.
- Produces: listagem, criação, detalhe/linha do tempo e cancelamento de avisos do morador.

- [ ] **Step 1: Escrever testes Flutter que falham**
  Cobrir serialização do aviso, criação para unidade própria, apresentação de status e ocultação de campos internos do entregador.
- [ ] **Step 2: Rodar testes focados e confirmar falha**
  Run: `flutter test test/delivery`
- [ ] **Step 3: Implementar modelo e controller**
  Adicionar chamadas autenticadas, tratamento de erro recuperável e atualização somente após resposta bem-sucedida.
- [ ] **Step 4: Implementar telas e navegação**
  Criar lista, formulário de aviso e detalhes com status; limitar cancelamento ao estado AGENDADA.
- [ ] **Step 5: Rodar testes focados e análise**
  Run: `flutter test test/delivery` e `flutter analyze`.
- [ ] **Step 6: Commit**
  `git add click-cond-app/click-cond-app && git commit -m "feat(delivery): adicionar avisos de entrega no aplicativo"`

### Task 4: Integração, build e teste publicado

**Files:**
- Modify: somente correções identificadas pelos testes anteriores.
- Test: builds de web/API/app e roteiro Playwright MCP.

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: commit de produção e evidência de validação no ambiente AWS.

- [ ] **Step 1: Executar verificações integradas**
  Rodar testes relevantes, `npm exec nx build portaria-web`, build API aplicável e `flutter analyze`.
- [ ] **Step 2: Executar revisão final de código**
  Verificar escopo condominial, transições, dados privados e regressões no diff completo.
- [ ] **Step 3: Criar commit final e enviar ao ramo de produção configurado**
  Confirmar remoto/ramo e fazer `git push` somente depois das verificações verdes.
- [ ] **Step 4: Aguardar GitHub Actions/AWS e testar com Playwright MCP**
  Logar no endereço fornecido, abrir Delivery, validar rota/menu/cadastro de motoboy e registrar o resultado sem expor credenciais.

## Self-review

- Cobertura da spec: Tasks 1–3 cobrem os dados, estados, permissões, interfaces e notificações; Task 4 cobre build, deploy e validação publicada.
- Placeholders: nenhum; cada tarefa declara arquivos, interfaces, comandos e entregável.
- Consistência: `id_entregador`, `status`, `motivo` e transições são produzidos na Task 1 e consumidos nas Tasks 2–3.
- Review focus: cada caso está coberto nos testes da Task 1, com estados/erros de cliente nas Tasks 2–3.
