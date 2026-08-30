# Áreas sociais — regras de convivência que faltam

Segunda leva de melhorias, na ordem de dor decrescente. Origem: análise dos
atritos reais do dia a dia das áreas comuns, 28/08/2026.

## Contexto

Base já entregue (commits `d97328f`..`0a6238c`, em produção): horários livres
corrigidos, manutenção bloqueando reservas novas, status `cancelado`, e regras
de texto por área.

Arquivos: API em `click-cond-web/apps/api/src/app/areas-sociais/`; app em
`click-cond-app/click-cond-app/lib/pages/shared/areas sociais/`; web em
`click-cond-web/apps/portaria-web/src/app/areas-sociais/`.

## Global Constraints

- **Escopo por tenant não muda**: tudo passa por `this.tenant.assert*` com o JWT.
- **App publicado**: respostas só podem GANHAR campos. Requisições novas devem
  ser opcionais — o app antigo não envia campos novos e não pode quebrar.
- **Fuso**: use `agoraNoFusoDoCondominio()` / `TIMEZONE_CONDOMINIO`, nunca
  `new Date()` cru, para qualquer decisão de "hoje" ou "agora".
- **Manutenção**: as janelas usam `combineDateTime` + `colideComJanela`
  (desigualdade estrita). Reaproveite, não reescreva.
- **Push**: `this.notifications.sendPushNotification(token, title, body, data)`,
  como em `updateStatusAgendamento`. Falha de push nunca derruba a operação.
- Testes: `npx nx test api --testPathPatterns=areas-sociais` a partir de
  `click-cond-web`.

---

## Task 1 — Manutenção avisa e cancela as reservas atingidas

Hoje `insertManutencao`/`updateManutencao` só gravam a janela. As reservas que
já existiam dentro dela continuam válidas: o morador não é avisado, e em área
com `controle_acesso_facial` a catraca ainda abre para ele. Foi o buraco que a
entrega anterior deixou ao passar a bloquear apenas reservas NOVAS.

Comportamento novo, em duas fases (nada é destruído sem confirmação):

1. `insertManutencao` e `updateManutencao` passam a detectar os agendamentos com
   status `pendente` ou `aprovado` que colidem com a janela informada.
2. Sem confirmação explícita no corpo (`confirmar_cancelamentos: true`), a
   requisição **não grava nada** e responde **409 Conflict** com
   `{ conflitos: [{ id, data, hora_de, hora_ate, bloco, apto }], total }`.
3. Com `confirmar_cancelamentos: true`, grava a manutenção e, para cada
   agendamento atingido: marca `status: 'cancelado'` (NÃO apagar — o status
   já é filtrado fora de `horarios_livres` e o facial revoga acesso por não ser
   `aprovado`), chama `facial.syncReservaArea(id)` no mesmo padrão
   best-effort já usado (falha só loga), e envia push ao dono da reserva com o
   título "Reserva cancelada" e o motivo, citando área e data.

O app publicado nunca envia `confirmar_cancelamentos`. Isso é aceitável e
desejado: pela versão antiga, marcar manutenção sobre reservas passa a falhar
com mensagem clara em vez de criar a inconsistência silenciosa de hoje.

Interfaces: `AreasSociaisController` repassa o corpo como já faz. Se o 409 exigir
um formato de erro, use `ConflictException` do NestJS com o objeto acima.

**Web e app (telas de manutenção)**: ao receber 409, mostrar quantas reservas
serão canceladas, listar data/hora/unidade e pedir confirmação; ao confirmar,
repetir a chamada com a flag. `new_manutencao_area_social.dart` no app e o
componente correspondente na portaria-web.

**Testes**: janela sem conflito grava direto; janela com conflito sem a flag não
grava nada e devolve 409 com a lista; com a flag grava, marca `cancelado` só nos
atingidos (não em reservas fora da janela nem já `recusado`), e dispara push por
dono. Falha de push não impede o cancelamento.

---

## Task 2 — Convidados validados contra a capacidade

`Areas_Sociais.capacidade` está cadastrada e não é usada em lugar nenhum. A
portaria não sabe quantas pessoas esperar, e a área estoura.

- **Migração**: `ALTER TABLE Areas_Sociais_Agendamentos ADD COLUMN convidados INT NULL;`
  e `convidados Int?` no `schema.prisma`, seguido de `npx prisma generate`.
- **API**: `insertAgendamento` aceita `convidados` opcional; quando informado e
  a área tem `capacidade > 0`, recusa com `BadRequestException` se exceder.
  Ausente continua válido (app antigo). `get`, `agendamentos/get-all` e
  `meus-agendamentos/get-all` devolvem o campo.
- **App**: campo numérico na reserva, com a capacidade da área como dica e
  validação local antes do envio.
- **Portaria-web**: coluna na listagem de agendamentos.

**Testes**: dentro da capacidade grava; acima recusa; ausente grava; área com
capacidade 0 ou nula não valida nada.

---

## Task 3 — Limite de reservas por apartamento

Sem limite, o mesmo apartamento reserva todos os fins de semana.

- **Migração**: `ALTER TABLE Areas_Sociais ADD COLUMN limite_mensal_apto INT NULL;`
  e `limite_mensal_apto Int?` no `schema.prisma` + generate. Null ou 0 = sem limite
  (comportamento atual preservado para todas as áreas existentes).
- **API**: em `insertAgendamento`, contar os agendamentos `pendente`/`aprovado`
  do mesmo `id_apartamento`, na mesma área, dentro do mês da data solicitada
  (mês calculado no fuso do condomínio). Ao atingir o limite, recusar com
  mensagem dizendo o limite e o mês. Reserva feita pelo síndico **não** conta
  contra o limite nem é bloqueada por ele.
- **Cadastro da área**: campo no app (`new_area_social.dart`) e na portaria-web,
  com texto explicando que vazio significa sem limite.

**Testes**: abaixo do limite grava; no limite recusa; cancelada/recusada não
conta; limite nulo não bloqueia; síndico não é bloqueado; a virada de mês usa o
fuso do condomínio.
