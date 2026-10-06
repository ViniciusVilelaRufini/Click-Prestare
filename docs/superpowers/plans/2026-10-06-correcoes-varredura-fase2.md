# Correções da varredura — fase 2 (pendências decididas pelo controlador)

Continuação de `2026-10-06-correcoes-varredura-producao.md`, mesma branch `fix/varredura-producao-2026-10-06`.

## Global Constraints

- UI e mensagens em português do Brasil.
- Monorepo: `click-cond-web/` (NestJS `apps/api`, Angular `apps/portaria-web`). Leia `click-cond-web/CLAUDE.md` e `AGENTS.md` antes de editar.
- **Não** fazer `git push`, deploy, migração SQL nem acesso ao banco de produção.
- Stage só dos arquivos da própria tarefa (o working tree tem muitos arquivos não rastreados de outras coisas; nunca `git add -A` nem `git add .`).
- Mudança mínima, sem refatorar código vizinho; cada correção traz teste.
- Rodar jest/vitest/nx só escopado ao que mudou (o projeto api roda a partir de `click-cond-web/apps/api` com `npx jest <nome>`; o portaria-web com `npx nx test portaria-web`).

## Task 1: Portaria-web — três ajustes pequenos em arquivos distintos (um commit por ajuste)

### 1a. Botões editar/excluir do Comunicado só aparecem no hover
Arquivos: `click-cond-web/apps/portaria-web/src/app/comunicados/comunicados-page.component.html` (~linhas 123–140).
Causa raiz: os botões "Editar" e "Excluir" usam `opacity-0 group-hover:opacity-100`, então em tela de toque ficam invisíveis e em desktop são pouco descobríveis. A varredura em produção concluiu, por isso, que "não dá para editar nem excluir".
Requisito: os dois botões ficam sempre visíveis (remover `opacity-0 group-hover:opacity-100`), mantendo cor discreta (`text-slate-500`) e os estilos de hover atuais. Sem mudar lógica. Teste: spec de DOM que renderiza a página com um comunicado (service stub) e confirma que os botões com `title="Excluir"` e o de editar existem e não têm a classe `opacity-0`.

### 1b. Dashboard diz "Nenhum ativo" para comunicados
Arquivos: `click-cond-web/apps/portaria-web/src/app/dashboard/dashboard-page.component.html` (~linhas 530–550).
Causa raiz: `comunicadosRecentes` conta comunicados dos últimos 7 dias, mas o rótulo sem comunicados diz "Nenhum ativo" (comunicados não têm conceito de "ativo"), o que contradiz a página de Comunicados com itens listados.
Requisito: trocar o texto para `Nenhum nos últimos 7 dias`. Conferir o rótulo do ramo com contagem > 0 ao lado e, se disser "ativos", ajustar para "nos últimos 7 dias" mantendo o número. Procurar spec existente do dashboard; se houver, ajustar/estender; se não houver, um teste simples de DOM para os dois ramos.

### 1c. Encomendas: erro de validação separado do erro de ações
Arquivos: `click-cond-web/apps/portaria-web/src/app/encomendas/encomendas-page.component.ts` e `.html`, e o spec `encomendas-page.erro-recebida.spec.ts` (criado na rodada anterior, commit 50389fa2).
Causa raiz: um único signal `error` serve para validação do formulário e para erros de ações de linha (receber/notificar/retirar/carregar). Com o formulário aberto, erros de ação aparecem dentro de "Receber nova encomenda".
Requisito: criar signal `formError` só para as mensagens de `registrar()` (validação e falha do `create`). O formulário exibe `formError()` acima dos botões. `error()` volta a ser renderizado sempre como banner global, sem a condição `&& !showForm`. Limpar `formError` ao abrir o formulário (inclusive via `?novo=true`), ao cancelar, ao iniciar `registrar()` e no sucesso. Atualizar o spec existente (o teste que afirma "erro de ação não aparece no form"/"banner só sem form" deve passar a afirmar o novo comportamento) e cobrir: validação aparece no form, erro de ação aparece no banner mesmo com o form aberto, sucesso limpa `formError`.

## Task 2: API — timestamp do feed e coluna "dataEntrada" dos relatórios para encomendas "Esperando"

Arquivos: `click-cond-web/apps/api/src/app/auth/mobile-auth.service.ts` (bloco "Encomendas endereçadas ao apto/bloco do morador", `timestamp: e.created_at`, ~linha 1667) e `click-cond-web/apps/api/src/app/relatorios/relatorios.service.ts` (~linhas 950–980, onde `recebido_em` vira "dataEntrada").

### 2a. Feed de notificações
Causa raiz: o feed usa sempre `created_at` como `timestamp`. Uma encomenda avisada pelo morador (`Esperando`) e depois recebida na portaria (`Aguardando`) mantém o horário do aviso, então o app não a marca como nova quando ela chega (o app compara o timestamp com a última visita ao feed).
Requisito: `timestamp` = momento do evento mais recente conhecido: se status `retirada` → `retirado_em ?? recebido_em ?? created_at`; se `aguardando` (ou qualquer outro que não seja `esperando`) → `recebido_em ?? created_at`; se `esperando` → `created_at`. Confirmar no `prisma/schema.prisma` os nomes reais dos campos de retirada (ex.: `retirado_em`, `data_retirada`) antes de usar; se não houver campo de retirada, usar só `recebido_em ?? created_at`. Não mudar `id`, `tipo`, `titulo` nem `descricao`. A cláusula `where created_at >= cutoff` e o `orderBy` permanecem como estão (apenas o campo `timestamp` retornado muda); se a ordenação final do feed por timestamp existir mais adiante no método, ela passa a usar o novo valor automaticamente — conferir que não há erro de tipo. Estender o spec `mobile-auth.notificacoes-encomenda.spec.ts` para cobrir os três casos de timestamp.

### 2b. Relatórios
Causa raiz: o relatório de encomendas expõe `recebido_em` como `dataEntrada` também para `Esperando`, que ainda não chegou — mesmo defeito que a tela da portaria tinha.
Requisito: para status `Esperando`, `dataEntrada` fica `null` (ou o valor "vazio" que o relatório já usa para ausência — seguir o padrão do arquivo), nunca a data de aviso/criação. Demais status inalterados. Teste jest no padrão do spec vizinho de relatórios; se o método for difícil de isolar, extrair somente a função pura de mapeamento e testá-la.

## Decisões sem código (Rulings do controlador)
- "Ciente" (web) × "Em andamento" (app): mantido. O app tem a aba "Em andamento" e mapeia Ciente para ela de propósito; para o morador, "a administração tomou ciência" equivale a "em andamento". Custo se errado: rótulo diferente entre superfícies.
- Visitante "No condomínio" desde 04/10: é dado de teste esquecido, não defeito de código; "Dar baixa" já existe. Sem expiração automática (mudar regra de presença é decisão de produto e mexe no controle de acesso).
