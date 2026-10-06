# Áreas Sociais (app) — redesign visual — Plano

Spec (autoridade): `docs/superpowers/specs/2026-10-06-areas-sociais-visual-design.md`. Branch: `feat/areas-sociais-visual`.

## Global Constraints
- Tudo em `click-cond-app/click-cond-app/` (Flutter). Pasta das telas: `lib/pages/shared/areas sociais/` (com espaço no nome — usar aspas). Componentes novos em `lib/pages/shared/areas sociais/widgets/`.
- Textos em pt-BR. Tema claro/escuro: só `AppColors.*(context)`, `AppSpacing`, `AppTypography`, `PhosphorIcons` (ver como as telas atuais usam). Nada de cor fixa que quebre o modo escuro (exceto cores semânticas de status).
- Não alterar API, models de rede, nem a lógica de salvar/validar/editar/excluir em `new_reserva.dart` (mensagens e regras de validação permanecem exatamente as atuais).
- Sem pacote novo (`table_calendar` ^3.2.0 já é dependência; `intl` também).
- NÃO fazer `git push`, build de loja nem publicar. Stage só dos arquivos da tarefa (a árvore tem muitos arquivos não rastreados; nunca `git add -A`/`git add .`).
- SDK Flutter: `C:\Users\vinic\Desktop\flutter\bin\flutter.bat`; rodar de `click-cond-app/click-cond-app`: `flutter analyze <arquivos>` e `flutter test <arquivos>`. Emulador não disponível para os subagentes.
- Cada componente com teste (unitário para funções puras, widget test para widgets).

## Task 1: Componentes e helpers
Criar em `widgets/`, seguindo a seção "Componentes novos" do spec:
1. `reserva_helpers.dart` (puro): `reservasVisiveis`, `statusReservaInfo`, `resumoReserva`, mais `duracaoHorario('10:00','16:00') -> '6 h'` (e `'1 h 30'` para minutos; virada de dia não existe). Regra de `reservasVisiveis`: quando `podeVerTodas` → status pendente/aprovado de todas; senão → só as do `bloco`+`apto` informados com status pendente/aprovado/recusado. Ignorar maiúsculas/espaços no status. `statusReservaInfo` cobre pendente (âmbar, "Pendente"), aprovado (verde, "Aprovada"), recusado (vermelho, "Recusada"), cancelado (cinza, "Cancelada"), desconhecido (cinza, texto original).
2. `reserva_status_badge.dart`, `minha_reserva_card.dart` (data, horário, convidados, selo, botão "Editar" quando callback dado, e bloco/apto quando `mostrarApto`).
3. `disponibilidade_calendario.dart`: recebe `Set<DateTime> diasDisponiveis` (datas sem hora), `selecionado`, `onSelecionar`; `table_calendar` pt-BR (domingo primeiro), dia disponível destacado, indisponível desabilitado, `firstDay`/`lastDay` = menor/maior dia disponível; trata conjunto vazio (mostra estado vazio "Nenhum dia disponível no momento").
4. `horario_card.dart` (faixa, duração, selecionado com check, `onTap`), `convidados_stepper.dart` (valor `int?`, mínimo 1, máximo `capacidade` quando > 0; botão + desabilitado no limite; − do valor 1 volta a "Opcional"/nulo; texto "de N" quando há capacidade), `resumo_reserva.dart`.
Testes em `test/areas_sociais_widgets_test.dart` (ou arquivos por componente): helpers (todos os ramos de status e filtro por papel/apto), calendário (dia indisponível não dispara callback, disponível dispara), stepper (limites e nulo), horário card, resumo, selo. Use `MaterialApp` com tema padrão nos widget tests; se os componentes dependerem de `AppColors(context)` com extensões de tema do app, siga o padrão de outros widget tests em `test/` (procure por `pumpWidget`).

## Task 2: Tela Reservar (`new_reserva.dart`)
Recompor o `build` com os componentes da Task 1 conforme "Tela Reservar (progressiva)" do spec. Manter intactos: `save()`, `delete()`, `load()`, validações, mensagens, `getAptoId`, seleção de bloco/apto por bottom sheet para síndico/funcionário, `AreaSocialReservaModel`. Substituir `ModalAgendaReserva`+`AppInput` de data pelo `DisponibilidadeCalendario` inline (derivando `diasDisponiveis` de `widget.obj['horarios_livres']` com `convertStringToDateFormat`), horários por `HorarioCard`, convidados por `ConvidadosStepper` (continua alimentando `txtConvidados`/validação existente), `ResumoReserva` quando há data+horário, botão de ação fixo no rodapé (`AppButton`, rótulo "Solicitar reserva"; desabilitado enquanto faltar data/horário/aceite das regras). No modo edição: sem calendário; mostra resumo e o botão excluir. Se `ModalAgendaReserva` não for mais usado em lugar nenhum, não removê-lo (fora do escopo). Teste de widget das regras de habilitação do botão se viável sem rede (stub dos dados via `widget.obj`); caso contrário justificar no relatório.

## Task 3: Tela Detalhe da área (`area_social_detail.dart`)
Recompor conforme "Tela Detalhe" do spec, usando `reservasVisiveis` + `MinhaReservaCard` (regra de papel igual à de `_canEditAgendamento`: síndico, permissão `areas_sociais` ou o apto do morador). Chips de tag compactos na mesma linha; clima em chip discreto reaproveitando `_buildWeatherWidget` (mantendo o timeout e o "some em falha"); regras num card recolhível (`ExpansionTile` ou equivalente, recolhido por padrão); estado vazio das reservas; botão "Reservar este espaço" fixo no rodapé nas mesmas condições da regra atual, abrindo `NewReserva` como hoje e recarregando ao voltar. Manter o hero/ocupação/placeholder e as ações de editar/cancelar reserva existentes funcionando (mesmos callbacks). Teste: helpers já cobertos; widget test só do que for viável, senão justificar.

## Verificação final (controlador)
`flutter analyze` limpo nos arquivos alterados, `flutter test` dos testes novos, build debug x86_64 e instalação no emulador para conferência visual.
