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
## Rodada 3 - 23/09/2026

- Fluxo: porteiro confirma no console o recebimento de uma encomenda pre-registrada no app pelo morador (`Esperando -> Aguardando`).
- Escopo validado: papel, condominio, apartamento, duplicidade e consistencia app -> portaria-web -> API. O app pre-registra somente para o apartamento da sessao; a portaria-web exige operador; a API valida o condominio da encomenda antes de alterar. A transicao preserva o destinatario (apartamento/bloco).
- Reproducao (RED): confirmar novamente uma encomenda ja fora de `Esperando` nao tinha guarda de estado; o fluxo usava `update` filtrado apenas por ID e podia repetir atualizacao, notificacao e auditoria.
- Causa raiz: a confirmacao nao era uma transicao atomica de estado; dois cliques concorrentes podiam ambos ser aceitos.
- Correcao: `receber()` usa `updateMany` com `where { id, status: 'Esperando' }`. Sem linha alterada, retorna `ConflictException` antes de notificar ou auditar; com uma linha alterada, recarrega o registro e segue o fluxo normal.
- GREEN: `encomendas.receber-duplicidade.spec.ts` passou e prova que a segunda confirmacao nao busca moradores nem dispara push.
- Verificacao: teste direcionado API 1/1; typecheck e build API passaram (aviso conhecido de sourcemap Prisma ausente); suite portaria-web 59/59 e build passaram; suite Flutter 182/182 e APK debug passaram. A suite Jest integral da API excedeu 120 s sem resultado consolidado.
- Aguardando aprovacao: nenhuma acao de banco ou publicacao. O commit desta rodada sera apenas local em `master`.
## Rodada 4 - 23/09/2026

- Fluxo auditado: retirada de encomenda pelo porteiro no app Flutter (`POST /encomendas/retirar`).
- Reproducao RED: uma encomenda ja retirada retornava `NotFoundException` quando a chamada duplicada era simulada; o fluxo usava `update({ where: { id } })` sem exigir o estado `Aguardando`.
- Causa raiz: duas requisicoes concorrentes podiam sobrescrever os dados da retirada (inclusive foto/assinatura) e gerar mais de um registro de auditoria.
- Correcao GREEN: a transicao agora e atomica com `updateMany({ id, status: 'Aguardando' })`; somente a primeira chamada atualiza, recupera a encomenda e audita. As demais retornam `ConflictException` e preservam a evidencia original.
- Isolamento: `assertEncomendaDoTenant` continua sendo executado antes da transicao; o apartamento e os dados da encomenda nao sao alterados pela retirada. O app classifica `Funcionario` como equipe e usa este endpoint; moradores usam o fluxo separado.
- Teste: `encomendas.retirar-duplicidade.spec.ts` criado em RED e aprovado em GREEN (1/1).
- Verificacao: teste direcionado e typecheck da API aprovados; build da API aprovado; testes/build do portaria-web aprovados (59/59); testes Flutter e APK debug aprovados (182/182). A suite completa da API foi tentada, mas excedeu 64 s e foi interrompida sem resultado final.
- Aguardando aprovacao: nenhuma publicacao nem escrita em banco de producao foi realizada nesta rodada.

## Correção pontual — 24/09/2026

- Fluxo: indicador "Visitantes no condomínio" no dashboard da portaria após entrada facial de visitante recorrente.
- Reprodução (RED): o evento facial era corretamente exibido como `VISITANTE`, porém o indicador permanecia em 0. O teste comprovou que a consulta contava apenas registros com o marcador legado `is_visitante = 1`.
- Causa raiz: ao converter um cadastro que antes era prestador em visitante recorrente, a classificação atual usa `is_prestador = 0`, mas registros históricos podem manter `is_visitante = 0`. A leitura do dashboard usava o campo legado e excluía uma visita ativa válida.
- Correção (GREEN): as duas consultas de visitantes ativos (modelo migrado e legado) agora excluem somente `is_prestador = 1`. Assim, visitantes recorrentes são contabilizados e prestadores continuam fora do card.
- Validação: teste direcionado `dashboard.pessoas-visitas.spec.ts` 5/5 passou; typecheck e build da API passaram. O build mantém apenas o aviso conhecido do sourcemap Prisma ausente.
- Aguardando aprovação: commit/publicação desta correção e nenhuma escrita direta no banco de produção.
