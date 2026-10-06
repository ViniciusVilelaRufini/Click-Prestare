# Áreas Sociais (app) — redesign visual

Escopo: telas **detalhe da área** (`area_social_detail.dart`) e **Reservar/Editar reserva** (`new_reserva.dart`) do app Flutter (`click-cond-app/click-cond-app/lib/pages/shared/areas sociais/`). Sem mudança de API nem de regra de negócio.

## Decisões (aprovadas pelo usuário em 06/10/2026)
- Redesign (não só polimento), com a abordagem "componentes novos + telas recompostas".
- Reserva em **página única progressiva**: calendário inline → horários do dia → convidados → resumo → botão.
- Detalhe da área mostra **só as reservas do morador** com selo de status; síndico e funcionário com permissão `areas_sociais` continuam vendo todas (com bloco/apto no card).
- Sem pacote novo: `table_calendar` já é dependência.

## Restrições dos dados (verificadas no código)
- `area['horarios_livres']` é `{ 'dd/MM/yyyy': [ {horarioDe, horarioAte} ] }` e só traz o que está **livre**. Não há como mostrar horário "ocupado" sem mudar a API → fora do escopo.
- `area['agendamentos']` traz `id, bloco, apto, data (dd/MM/yyyy), horaDe, horaAte, status, convidados, confirmada_em` de todos. Status possíveis: pendente, aprovado, recusado, cancelado.
- Morador reconhecido por `Singleton.instance.bloco` + `apartamento` (mesma regra de `_canEditAgendamento`).
- `capacidade` 0/nula = sem limite. Convidados é **opcional**; se preenchido: inteiro > 0 e ≤ capacidade.
- Regras da área: se existirem, é obrigatório aceitar antes de salvar (exceto edição).
- Modo edição (`objEditReserva`): data e horário fixos, bloco/apto bloqueados, só o botão excluir.
- Funcionário/síndico escolhem bloco e apto por bottom sheet; morador vem preenchido.
- Tema claro/escuro via `AppColors.*(context)`, `AppSpacing`, `AppTypography`; ícones `PhosphorIcons`.

## Componentes novos (`areas sociais/widgets/`)
1. `reserva_helpers.dart` — funções puras: `reservasVisiveis(lista, {podeVerTodas, bloco, apto})` (regra na seção "Decisão sobre status" abaixo), `statusReservaInfo(status)` → rótulo pt-BR + cor semântica + ícone, `resumoReserva(data, horario, convidados)`.
2. `disponibilidade_calendario.dart` — `table_calendar` inline em pt-BR, semana começando no domingo, dias disponíveis destacados, demais desabilitados, selecionado em `AppColors.primary`, navegação de mês limitada ao intervalo com disponibilidade.
3. `horario_card.dart` — card selecionável com faixa "10:00 – 16:00" e duração ("6 h"), estado selecionado com check.
4. `convidados_stepper.dart` — botões − e +, valor central, "de N" quando há capacidade; limites respeitados; estado vazio "Opcional".
5. `resumo_reserva.dart` — card com área, data por extenso, horário, convidados e apto.
6. `reserva_status_badge.dart` e `minha_reserva_card.dart` — selo de status e card da reserva (data, horário, convidados, selo; "Editar" quando permitido).

Decisão sobre status: o detalhe lista reservas **pendente, aprovado e recusado** do morador (recusada com selo vermelho); canceladas não aparecem. Síndico/funcionário veem pendente e aprovado de todos (como hoje).

## Tela Reservar (progressiva)
- Cabeçalho compacto: nome da área, capacidade, (bloco/apto como chip; selecionáveis para síndico/funcionário).
- Seção Data: calendário. Seção Horário: aparece após escolher o dia (cards). Seção Convidados: aparece após escolher o horário. Regras + aceite: após horário, se houver. Resumo: aparece com data+horário.
- Botão "Solicitar reserva" (ou "Confirmar reserva" quando a área não exige autorização) fixo no rodapé, desabilitado até data e horário (e aceite, se houver regras). Validações atuais mantidas, com as mesmas mensagens.
- Edição: mostra o resumo e o botão excluir; sem calendário.

## Tela Detalhe
- Hero atual mantido (foto, nome, capacidade, selo de ocupação); tags de Agendamento/Autorização/Pagamento viram chips compactos na mesma linha (wrap).
- Clima em chip discreto (some em falha, como já faz).
- Regras num card recolhível ("Regras de uso").
- "Minhas reservas" com `minha_reserva_card`; estado vazio com ícone e texto curto.
- Botão primário "Reservar este espaço" fixo no rodapé (só quando `precisa_agendar == 1` e o usuário pode reservar, igual à regra atual).

## Testes
- Funções puras: teste unitário. Widgets: teste de widget (renderiza, estados, callbacks, limites do stepper, dias desabilitados).
- Telas: teste de widget só do que for viável sem rede; senão, `flutter analyze` + verificação manual no emulador (build debug x86_64).

## Fora do escopo
- API, horário "ocupado", pagamento, tela de listagem de áreas e cadastro de área (`new_area_social.dart`), tela de aprovação do síndico.
