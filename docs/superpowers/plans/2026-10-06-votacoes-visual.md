# Enquetes e Assembleias (app) — navegação e redesign visual — Plano

Design aprovado em chat (06/10/2026), caminho "bounded": só app Flutter, **sem API, sem banco, sem web**. Branch `feat/votacoes-visual` (empilhada sobre `feat/areas-sociais-visual`; arquivos distintos).

## Decisões aprovadas
- A tela de lista de **Enquetes** hoje usa o título `lb_votacoes` ("Votações") — passa a usar `lb_enquetes` ("Enquetes").
- O item de menu "Assembleias e Votações" (`my_condominium.dart:168`, chave `lb_assembleia_votacoes`) abre só a lista de assembleias. Não haverá aba de Votações (as votações avulsas são as Enquetes). O item passa a se chamar **"Assembleias"** (chave existente `lb_assembleias`); o filtro do funcionário em `my_condominium.dart:199`, que compara por rótulo, deve usar o mesmo rótulo novo. As votações que pertencem a uma assembleia continuam dentro do detalhe dela.
- Redesign: lista de Enquetes (chips de mês limpos, cards com selo de status, título, prazo e total de votos), detalhe da enquete (opções como cards selecionáveis, resultado em barras com percentual, destaque da opção votada, mensagem clara quando encerrada/já votou, botão de votar fixo no rodapé quando houver voto a dar), lista de Assembleias (data/hora, local, quantidade de votações se o dado existir na lista), votações dentro do detalhe da assembleia com o mesmo visual das enquetes.

## Global Constraints
- Tudo em `click-cond-app/click-cond-app/` (Flutter). Textos em pt-BR via `getText` quando já existir chave (veja `lib/utils/localizable/localizable_pt_br.dart`; não criar chaves novas nesta rodada — texto sem chave fica em pt-BR fixo, listado no relatório).
- Tema claro/escuro: só `AppColors.*(context)`, `AppSpacing`, `AppTypography`, `AppRadius`, `PhosphorIcons` (cores semânticas de status — verde/âmbar/vermelho/cinza — exceção permitida). Siga o visual das telas de Áreas Sociais já refeitas (`lib/pages/shared/areas sociais/widgets/` e `area_social_detail.dart`) para manter consistência.
- **Não alterar** API/rede, models, nem a lógica de votar (`insertVoto`, `apiSaveObject("assembleias/votacoes/voto", ...)`), finalizar (`finish`), remover, nem as telas de criação (`new_assembleia.dart`, `new_votacao.dart`) — só apresentação. Mesmos callbacks, mesma navegação, mesmas regras de quem pode finalizar (síndico com status 1).
- Status da votação: 0 agendada, 1 em andamento, 2 finalizada (veja `_statusLabel`/`_statusColor` em `detail_enquete.dart` e as chaves `votacao_agendado`, `votacao_andamento`, `votacao_finalizado`).
- Sem pacote novo. NÃO fazer `git push`/build de loja. Stage só dos arquivos da tarefa (a árvore tem muitos arquivos não rastreados; nunca `git add -A`/`git add .`).
- SDK: `C:\Users\vinic\Desktop\flutter\bin\flutter.bat`; de `click-cond-app/click-cond-app`: `flutter analyze <arquivos>` e `flutter test`. Emulador indisponível para subagentes. Cada componente com teste (unitário nas funções puras, widget test nos widgets); testes de tela sem rede real (veja como `test/areas_sociais_detail_test.dart` e `test/areas_sociais_new_reserva_test.dart` usam `ApiClient.client = MockClient`, `ensureStorageReady()`, `Singleton` e restauram no tearDown).

## Task 1: Componentes compartilhados de votação
Criar em `lib/widgets/votacao/` (leia primeiro `detail_enquete.dart`, `list_enquetes.dart`, `lib/widgets/cells/cell_votacao.dart` para os campos reais: `titulo`, `pergunta`, `status`, `data_inicio`, `data_termino`, `opcoes[...]` — descubra os nomes dos campos de votos/total/“meu voto” de cada opção no que a API devolve, lendo `assembleias.service.ts` (`getVotacoesFormatadas`, `enqueteGetDetails`) em `click-cond-web/apps/api/src/app/assembleias/` só para LER):
1. `votacao_helpers.dart` (puro): `totalVotos(opcoes)`, `percentual(votos, total)` (0 quando total 0, arredondado, soma coerente), `prazoLabel(dataTermino, status, {agora})` ("Encerrada", "Encerra hoje", "Encerra em 3 dias", "Começa em 2 dias" para agendada; tolera data inválida), `statusVotacaoInfo(status)` → rótulo (via `getText`)/cor/ícone.
2. `votacao_status_badge.dart`, `votacao_card.dart` (título, selo, chip de prazo, total de votos, subtítulo opcional, `onTap`), `opcao_resultado_bar.dart` (rótulo, votos, percentual, barra animada, destaque quando é o voto do usuário), `opcao_selecionavel.dart` (card com rádio, estado selecionado/desabilitado).
Acessibilidade: semantics com rótulo completo e ação de toque (cuidado com `excludeSemantics` sem `onTap`), alvos ≥ 48dp. Testes unitários + de widget (incl. 320dp sem overflow e tema escuro).

## Task 2: Enquetes (lista + detalhe) e correção de título
Em `lib/pages/shared/enquetes/list_enquetes.dart`: título `getText('lb_enquetes')`; chips de mês mais limpos (mesma lógica de filtro/ordenação/scroll atual); itens com `VotacaoCard`; estado vazio e skeleton mantidos/aprimorados. Em `detail_enquete.dart`: redesenhar usando `OpcaoSelecionavel` (quando ainda dá para votar) e `OpcaoResultadoBar` (quando encerrada ou já votou), cabeçalho com selo/prazo/total de votos, mensagem clara de estado, botão "votar" fixo no rodapé (habilitado só com opção escolhida) e botão de finalizar do síndico preservado. Preservar `finish`, `insertVoto` e carregamento. Testes de widget das duas telas sem rede real; se infactível, justificar.

## Task 3: Assembleias (menu, lista, detalhe)
1. `lib/pages/shared/my_condominium.dart`: o item de menu usa `getText('lb_assembleias')` (linha ~168) e o filtro do funcionário (linha ~199) compara com o mesmo rótulo; mantenha o resto do menu idêntico.
2. `lib/pages/shared/assembleias/list_assembleias.dart`: cards redesenhados (título, data/hora, local e quantidade de votações se existirem no dado da lista; senão não inventar) com o mesmo estilo; vazio/skeleton.
3. `lib/pages/shared/assembleias/detail_assembleia.dart` e `lib/widgets/cells/cell_votacao.dart`: as votações usam o visual compartilhado (selo, prazo, barras/seleção) sem alterar `insertVoto`, remover ou "nova votação". Testes de widget; se infactível, justificar.
Garanta que o menu "Enquetes" continue abrindo `ListEnquetes` e que nada mais referencie o rótulo antigo.

## Verificação final (controlador)
`flutter analyze`, `flutter test` completo, build debug x86_64 e instalação no emulador para conferir Enquetes (lista/detalhe) e Assembleias.
