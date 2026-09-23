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
