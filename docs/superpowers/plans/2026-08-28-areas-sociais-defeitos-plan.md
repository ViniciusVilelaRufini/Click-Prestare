# Áreas sociais — os 5 defeitos que atrapalham o morador

Plano de implementação. Origem: análise de 28/08/2026 sobre `areas-sociais`
no app Flutter, na API NestJS e na portaria-web.

## Contexto

A reserva de área social passa por três lugares:

- **API NestJS** — `click-cond-web/apps/api/src/app/areas-sociais/`
  (`areas-sociais.service.ts` concentra as regras; `areas-sociais.controller.ts`
  expõe as rotas; `areas-sociais.authz.spec.ts` já cobre autorização).
- **App Flutter** — `click-cond-app/click-cond-app/lib/pages/shared/areas sociais/`
  (`list_areas_sociais.dart`, `area_social_detail.dart`, `new_reserva.dart`,
  `new_area_social.dart`).
- **Portaria-web (Angular)** — `click-cond-web/apps/portaria-web/src/app/areas-sociais/`.

O morador escolhe a área, abre a reserva, escolhe dia e horário a partir do mapa
`horarios_livres` que o `get` devolve, aceita as normas e envia. O síndico aprova
ou recusa; a aprovação dispara push e, em área com `controle_acesso_facial`,
sincroniza o enrolamento facial da janela reservada.

## Global Constraints

- **Escopo por tenant não muda.** Todo acesso continua passando por
  `this.tenant.assert*` com o JWT. Nenhuma tarefa aqui afrouxa autorização.
- **Compatibilidade do app publicado.** O app em produção consome `horarios_livres`
  como `Record<data "dd/MM/yyyy", Array<{horarioDe, horarioAte}>>`. O formato
  não pode mudar; campos novos só podem ser **adicionados** à resposta.
- **Status são strings livres** (`VarChar(50)`): `pendente`, `aprovado`,
  `recusado` e, novo, `cancelado`. Não há enum para migrar.
- **Migração de schema é manual em produção**, aplicada ANTES do push (o Railway
  não migra). Só a Tarefa 3 tem migração.
- **Datas em pt-BR**: `horarios_livres` é chaveado por `dd/MM/yyyy`
  (`toLocaleDateString('pt-BR')`); horas são `HH:mm`.
- Testes de backend rodam com `npx nx test api --testPathPatterns=areas-sociais`
  a partir de `click-cond-web`.

---

## Task 1 — Horários livres passam a dizer a verdade

Arquivo: `click-cond-web/apps/api/src/app/areas-sociais/areas-sociais.service.ts`,
método `get` (cálculo de `horarios_livres`) e método `insertAgendamento`.

Três correções no mesmo cálculo, porque as três decidem quais horários o morador
enxerga:

1. **Incluir hoje.** O laço faz `currDate.setDate(currDate.getDate() + 1)` como
   primeira instrução, então a primeira data ofertada é amanhã e nunca hoje.
   Passe a incluir hoje e mantenha o horizonte de **60 dias**. Para **hoje**,
   descarte os blocos cujo `horarioAte` já passou — oferecer horário vencido
   troca um defeito por outro. Compare com a hora local do servidor.

2. **Filtrar por status.** A busca que alimenta o cálculo
   (`this.prisma.areas_Sociais_Agendamentos.findMany`) filtra apenas
   `data: { gt: ontem }`. Adicione `status: { in: ['pendente', 'aprovado'] }`,
   o mesmo filtro que `insertAgendamento` já usa na checagem de conflito. Sem
   isso, uma reserva recusada ou cancelada continua removendo o horário da tela
   enquanto a API aceita reservá-lo.
   Atenção: a lista `agendamentos` devolvida na resposta serve à agenda da área
   (o síndico vê o histórico) — **não** filtre a lista devolvida, só a que
   alimenta `horarios_livres`.

3. **Subtrair manutenção.** `Areas_Sociais_Manutencoes` (campos `data_inicio`,
   `hora_inicio`, `data_termino`, `hora_termino`, `descricao`) hoje só é escrita
   e lida no CRUD; nada consulta essas janelas. Carregue as manutenções da área
   que ainda não terminaram e remova dos horários livres todo bloco que
   **intersecta** a janela — a manutenção pode cobrir vários dias e horas
   parciais, então compare data+hora, não só data. Um bloco `[horarioDe,
   horarioAte)` colide com a janela quando `inicioBloco < fimJanela` e
   `fimBloco > inicioJanela`.

Além do cálculo, `insertAgendamento` precisa **recusar** reserva que caia em
manutenção, com `BadRequestException('Esta área está em manutenção no horário
solicitado.')`. Tirar da lista não basta: a rota aceita POST direto.

Acrescente à resposta do `get` um campo novo `manutencoes`, com
`{ id, descricao, data_inicio, hora_inicio, data_termino, hora_termino }` em
formato pt-BR (`dd/MM/yyyy` e `HH:mm`), para a tela poder explicar por que o dia
sumiu. Campo **adicional** — não altere os existentes.

**Testes** em `areas-sociais.horarios.spec.ts` (novo), com Prisma mockado no
mesmo estilo de `areas-sociais.authz.spec.ts`:

- hoje aparece em `horarios_livres` quando ainda há bloco futuro;
- bloco de hoje que já terminou não aparece;
- agendamento `recusado` **não** remove o horário; `aprovado` e `pendente` removem;
- janela de manutenção remove os blocos que ela intersecta, inclusive parcial e
  atravessando dias;
- `insertAgendamento` lança `BadRequestException` para horário em manutenção.

---

## Task 2 — Cancelar deixa de virar "recusado"

Quando o morador remove a própria reserva já aprovada, `removeAgendamento`
grava `status: 'recusado'` — o histórico passa a dizer que o síndico negou.

- **API** (`areas-sociais.service.ts`, `removeAgendamento`): gravar
  `'cancelado'`. A recusa pelo síndico (`updateStatusAgendamento`) continua
  `'recusado'`. O efeito colateral existente — chamar `facial.syncReservaArea`
  para remover o enrolamento — continua igual para os dois casos.
- **App** (`meus_agendamentos_cells.dart`, `agendamentos_cells.dart` e o que
  mais pinte status): tratar `cancelado` com rótulo "Cancelado" e cor neutra
  (`AppColors.textSecondary`), distinta do vermelho de recusado. Status
  desconhecido não pode quebrar a tela nem cair no rótulo errado.
- **Portaria-web** (`areas-sociais-page.component.*`): mesmo tratamento na
  listagem de agendamentos.

**Testes**: caso em `areas-sociais.authz.spec.ts` ou spec novo garantindo que o
cancelamento pelo dono grava `cancelado` e que a recusa pelo síndico grava
`recusado`.

---

## Task 3 — Regras da área, visíveis antes do aceite

`new_reserva.dart` exige aceitar as normas (`area_social_erro_normas`), mas não
existe norma cadastrável nem exibida. Área nenhuma tem texto de regras.

- **Migração** (aplicar em produção ANTES do push):
  `ALTER TABLE Areas_Sociais ADD COLUMN regras TEXT NULL;`
  e o campo correspondente em `click-cond-web/prisma/schema.prisma`
  (`regras String? @db.Text`), seguido de `npx prisma generate`.
- **API**: `insert`/`update` passam a aceitar e gravar `regras`; `get` e
  `get-all` passam a devolvê-la.
- **App**: campo de texto multilinha no cadastro (`new_area_social.dart`);
  exibição no detalhe da área (`area_social_detail.dart`); em `new_reserva.dart`,
  o texto das regras aparece **acima** do checkbox de aceite. Área **sem** regras
  cadastradas não mostra o checkbox nem exige aceite — aceitar o nada não faz
  sentido e hoje é o que acontece.
- **Portaria-web**: campo equivalente no cadastro da área.

**Testes**: spec de backend cobrindo que `regras` é gravada e devolvida; no app,
validação manual (a tela de cadastro é de síndico).
