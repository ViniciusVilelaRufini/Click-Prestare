# Correções da varredura em produção (06/10/2026) — Plano

Origem: `ArquivosMd/VARREDURA_PRODUCAO_2026-10-06.md`. Cada tarefa abaixo já tem a causa raiz confirmada no código.
Branch: `fix/varredura-producao-2026-10-06` (criada de `master`).

## Global Constraints

- Idioma de toda UI e mensagem: português do Brasil.
- Monorepo: `click-cond-web/` (NestJS em `apps/api`, Angular em `apps/portaria-web`) e `click-cond-app/click-cond-app/` (Flutter). Leia `click-cond-web/CLAUDE.md` e `AGENTS.md` antes de editar a parte web.
- **Não** fazer `git push`, deploy, migração SQL nem qualquer acesso ao banco de produção. Só código e testes locais, commit na branch atual.
- Fazer stage só dos arquivos da própria tarefa (o working tree tem muitos arquivos não rastreados de outras coisas; nunca usar `git add -A` ou `git add .`).
- Mudança mínima: sem refatorar nem "melhorar" código vizinho.
- Cada correção traz teste (ou, onde não há infraestrutura de teste viável, justificativa no relatório).

## Task 1: Encomendas (web) — erro nunca limpa e aparece fora de vista

Arquivos: `click-cond-web/apps/portaria-web/src/app/encomendas/encomendas-page.component.ts` e `.html`.

Causa raiz: `registrar()` (ts ~linha 213) define `this.error` na validação mas nunca o limpa; no sucesso o formulário fecha e o banner antigo permanece. O banner (`@if (error())`, html ~linha 254) fica abaixo do formulário/tabela, longe do botão.

Requisitos:
1. `registrar()` limpa `error` no início e no sucesso. Também limpar ao abrir/cancelar o formulário (o botão do topo já faz `error.set(null)`; conferir o botão "Cancelar" do formulário).
2. Quando `showForm` estiver aberto, a mensagem de erro de validação aparece dentro do cartão do formulário, acima dos botões "Cancelar / Confirmar recebimento", e não só no fim da página. Fora do formulário (erros de notificar/receber/retirar) o banner continua como está.
3. Na tabela, a coluna "Recebida" mostra "—" (travessão) para encomendas com status `Esperando` (a chegar), em vez de data/hora. Os demais status ficam iguais. Aplicar nas duas visões (tabela e cartões mobile) se ambas renderizam a data.
4. Teste: seguir o padrão de teste do componente/Angular já existente no projeto (procurar `*.spec.ts` em `apps/portaria-web`); cobrir (a) erro some após cadastro com sucesso, (b) coluna "Recebida" com `Esperando`.

## Task 2: Central de notificações do app — encomenda "Esperando" aparece como "chegou"

Arquivo: `click-cond-web/apps/api/src/app/auth/mobile-auth.service.ts`, bloco "Encomendas endereçadas ao apto/bloco do morador" (~linhas 1623–1659).

Causa raiz: o feed é derivado do estado atual. `titulo`/`descricao` só distinguem `retirada` de "todo o resto". Uma encomenda com status `Esperando` (morador avisou, ainda não chegou) vira "Encomenda recebida — chegou e está aguardando retirada", o que é falso.

Requisitos:
1. Status `Esperando` (comparação case-insensitive, como já é feita para `retirada`): `titulo` = `Encomenda a caminho`, `descricao` = `${e.descricao} foi avisada e ainda não chegou na portaria.`
2. `retirada` e os demais status mantêm exatamente o texto atual.
3. Não mudar `id`, `tipo` nem `timestamp`.
4. Teste unitário (jest) no estilo dos specs vizinhos em `apps/api/src/app/auth/` ou `encomendas/`: encomenda `Esperando`, `Aguardando` e `Retirada` produzem os três textos esperados. Se o método que monta o feed for difícil de isolar, extrair **somente** a função pura de título/descrição e testá-la.

## Task 3: App Flutter — contadores, datas cruas e widget de clima

Pasta base: `click-cond-app/click-cond-app/lib/`. Três correções independentes em arquivos diferentes; fazer um commit por correção.

### 3a. Contadores de visitantes contam visitas, não pessoas
Arquivo: `pages/shared/visitantes/list_visitantes.dart`, no `build` (~linhas 1131–1230).
Causa raiz: os chips "Todos (N)" e "Visitantes (N)" usam `list.length`/`visitantesCount`, que contam cada linha de visita (um visitante com 20 entradas conta 20). A aba "Cadastrados" já deduplica por pessoa (documento, nome normalizado ou foto).
Requisito: os chips "Todos", "Visitantes" e "Prestadores" passam a contar **pessoas distintas** usando a mesma regra de deduplicação de `listCadastrados`. Extrair a regra de chave de deduplicação para uma função pura em `utils/` (ao lado de `visitantes_presenca.dart`), reusá-la nos dois pontos e cobrir com teste em `test/` no mesmo estilo dos testes de `visitantes_presenca`. "No local (N)" não muda.

### 3b. Datas em formato ISO cru no detalhe da ocorrência
Arquivo: `pages/shared/ocorrencias/detail_ocorrencia.dart`: linha ~200 (`obj['created_at']`) e linha ~380 (`obj['resposta_at']`).
Requisito: exibir no formato `dd/MM/yyyy HH:mm` no fuso local do aparelho (`DateTime.tryParse(...)?.toLocal()` + `DateFormat` do pacote `intl`, já dependência). Se não for possível interpretar, exibir o texto original. Criar uma função pura de formatação em `utils/` e testá-la (ISO com `Z`, ISO sem `Z`, nulo, texto inválido). Procurar antes se já existe helper equivalente em `utils/` e reusá-lo.

### 3c. Widget de clima da área social fica em skeleton sem fim
Arquivo: `pages/shared/areas sociais/area_social_detail.dart` (`_fetchWeatherForCondominium` ~linha 64, `_buildWeatherWidget` ~linha 312).
Causa raiz: sem timeout nas chamadas `http.get` (geocodificação + previsão); se travarem, `_weatherLoading` continua `true` e o bloco cinza fica para sempre. Em falha o widget não se esconde de forma clara.
Requisito: timeout de 8 s em cada `http.get`; em timeout/erro/resposta vazia `_weatherLoading` volta a `false` e o widget não renderiza nada (`SizedBox.shrink`). Sem mudar o visual no caminho de sucesso. Teste só se houver forma simples; senão, justificar no relatório.

Verificação da tarefa: `flutter analyze` nos arquivos alterados e `flutter test` nos testes novos/afetados (SDK em `C:\Users\vinic\Desktop\flutter\bin\flutter.bat`).

## Fora do escopo desta rodada (decisão do usuário pendente, não implementar)

- Nomear "Ciente" (web) vs "Em andamento" (app) — confirmar se é intencional.
- Editar/excluir comunicados (feature nova).
- Dashboard "Comunicados: Nenhum ativo" e visitante "No condomínio" desde 04/10 (dúvidas de regra/dados).
- Ocorrência #5 "facial offline": o código de auto-resolução (`facial.service.ts` ~l.716–756) está correto; é estado real do dispositivo (operacional).
