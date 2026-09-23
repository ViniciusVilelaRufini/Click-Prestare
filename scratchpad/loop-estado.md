# Auditoria contínua — Áreas Sociais e Encomendas

## Rodada 1 — 23/09/2026

- Fluxo: listagem NestJS de encomendas por condomínio (`GET /condominios/:idCondominio/encomendas`).
- Escopo validado: isolamento por condomínio e papel de portaria.
- Reprodução: um token de funcionário do condomínio 1 conseguia chamar a listagem do condomínio 2; o serviço consultava o Prisma sem chamar `TenantAccessService`.
- Causa raiz: `EncomendasController.list` não repassava o usuário autenticado e `EncomendasService.findAll` não validava o `idCondominio` da rota.
- Correção: propagar `@ReqUser()` até o serviço e executar `tenant.assertCondominio(...)` antes da consulta.
- RED: `encomendas.tenant.spec.ts` falhou com a promessa resolvendo a lista do condomínio 2.
- GREEN: o mesmo teste passou após a correção.
- Verificação executada: teste de regressão 1/1 passou; suíte Flutter 176/176 passou; builds da API, da portaria-web e APK debug passaram. A execução integral da suíte Jest da API excedeu o limite de 120 s sem produzir resultado consolidado, portanto permanece pendente para uma rodada dedicada.
- Pendências para próximas rodadas:
  - Encomendas: consistência entre o app Flutter (endpoints legados `/encomendas/*`) e o módulo Nest (`/condominios/:id/encomendas`), incluindo isolamento e duplicidade de rastreio.
  - Áreas sociais: percorrer fluxos ainda sem prova de isolamento entre apartamento/papel no app e na portaria-web.
- Aguardando aprovação: nenhuma ação de banco ou publicação. O commit será apenas local em `master`.

## Rodada 2 — 23/09/2026

- Fluxo: fila de agendamentos de áreas sociais no app Flutter para funcionário com a permissão `areas_sociais`.
- Escopo validado: coerência app Flutter ↔ API NestJS ↔ portaria-web, papel e condomínio. A API já exige operador e valida o `id_condominio`; a portaria-web já consome essa fila com o condomínio da sessão.
- Reprodução (RED): com funcionário autorizado do condomínio 22, a tela exibia a aba de agendamentos, mas disparava apenas `areas-sociais/get-all` e `meus-agendamentos/get-all`; a fila global não era requisitada. O teste widget falhou na expectativa da chamada `agendamentos/get-all`.
- Causa raiz: `ListAreasSociais.loadAll()` usava `getUserType() == 'sindico'` para carregar e atribuir a fila, enquanto a UI usava `_isSindico` (síndico **ou** funcionário com `areas_sociais == 1`) para exibir a aba.
- Correção: `loadAll()` passou a usar `_isSindico` nos dois pontos. Não altera permissão no backend nem envia dados de outro condomínio; apenas carrega a fila que a aba autorizada já apresentava.
- GREEN: o teste passou e comprovou a chamada `areas-sociais/agendamentos/get-all?id_condominio=22`.
- Verificação executada: suíte Flutter completa passou (179 testes). A execução Nx combinada (suíte da API + builds da API e portaria-web) não entregou resultado consolidado em 3 min, pois há outros processos Jest/Nx ativos no workspace; deve ser repetida em ambiente sem concorrência. Build APK debug também permanece pendente desta rodada.
- Aguardando aprovação: nenhuma ação de banco ou publicação.
