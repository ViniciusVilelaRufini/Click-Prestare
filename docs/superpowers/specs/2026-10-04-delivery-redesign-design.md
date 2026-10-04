# Delivery no console — redesenho estrutural e visual

Data: 2026-10-04
Área: `click-cond-web/apps/portaria-web/src/app/delivery` + `click-cond-web/apps/api/src/app/delivery`

## Problema

A tela `/delivery` do console funciona, mas:

- Abas sem estado ativo ("Fila" fica sempre destacada).
- Status exibido como enum cru ("CHEGOU", "AGUARDANDO AUTORIZAÇÃO"), sem cor; cards de contagem idênticos e sem indicar o filtro aplicado.
- Painel de detalhe só aparece após clique, deixando 1/3 da tela vazio; usa `bg-slate-50`, `text-indigo-700`, `bg-slate-800`, que quebram os temas claro/escuro; todas as ações têm o mesmo peso visual.
- A fila não mostra há quanto tempo o entregador espera nem o modo de entrega.
- Edição de entregador aparece no rodapé, longe do item clicado.
- Um único componente (290 linhas de TS + 145 de template) concentra fila, cadastro e histórico; usa `*ngIf/*ngFor` enquanto o resto do console usa `@if/@for`.
- `GET /delivery` devolve todos os atendimentos do condomínio desde sempre, com eventos; o front filtra tudo em memória e os contadores do "relatório" são da vida inteira.

## Backend (NestJS, sem migração)

### `GET /delivery` — parâmetros opcionais (somente operador)

| Parâmetro | Efeito |
|---|---|
| sem `escopo` | **comportamento atual inalterado** (o app Flutter do morador depende disso) |
| `escopo=ativos` | `status NOT IN (CONCLUIDA, CANCELADA, RECUSADA)`, sem limite de data |
| `escopo=historico` | `status IN (CONCLUIDA, CANCELADA, RECUSADA)` e `created_at` entre `de` e `ate`; `take: 500`; ordenado por `created_at desc` |

- `de`/`ate` são datas ISO (`YYYY-MM-DD`); `ate` é inclusivo (até 23:59:59 do dia). Se ausentes no histórico, padrão = últimos 30 dias.
- Valor de `escopo` inválido → `400`.
- Para não-operador, `escopo`/`de`/`ate` são ignorados (morador continua vendo só os próprios atendimentos, no formato atual).
- Combinação com `status` continua valendo (filtro adicional).

### `GET /delivery/resumo?id_condominio&de&ate` (somente operador; não-operador → `403`)

```json
{
  "ativos": { "AGENDADA": 0, "CHEGOU": 1, "AGUARDANDO_AUTORIZACAO": 0, "AUTORIZADA": 0, "RETIRADA_NA_PORTARIA": 0 },
  "periodo": { "de": "2026-09-04", "ate": "2026-10-04", "CONCLUIDA": 3, "CANCELADA": 0, "RECUSADA": 1, "total": 4 },
  "tempo_medio_atendimento_min": 7.5
}
```

- `ativos`: `groupBy status` nos não-terminais (sem filtro de data).
- `periodo`: `groupBy status` nos terminais com `created_at` no intervalo (mesmas regras de `de`/`ate`).
- `tempo_medio_atendimento_min`: média de `concluido_em − chegou_em` dos CONCLUIDA no período em que ambos existem; `null` se nenhum.
- Usa `tenant.assertCondominio` como os demais endpoints.
- O índice existente `(id_condominio, status, created_at)` atende às consultas.

## Front-end (portaria-web)

### Estrutura

```
delivery/
  delivery-page.component.{ts,html}       casco: cabeçalho, abas (segmented), faixa de erro, provê DeliveryStore
  delivery.store.ts                        estado com signals + ações (carregar, atualizarStatus, entregadores…)
  delivery.service.ts                      + listAtivos, listHistorico(de, ate), resumo(de, ate)
  delivery.model.ts                        + chegou_em/concluido_em…, DeliveryResumo
  shared/
    delivery-status.ts                     rótulo pt-BR com acento (caixa de frase), tom de cor, verbo da ação
    delivery-status-badge.component.ts     selo colorido
    delivery-timeline.component.ts         linha do tempo vertical (pontos + autor + hora)
    tempo-espera.ts                        "agora", "há 12 min", "há 1 h 05 min"; nível normal/atenção
  fila/
    delivery-fila.component.{ts,html}      cards-filtro, busca, lista
    delivery-detalhe.component.{ts,html}   painel fixo com ações
  entregadores/
    delivery-entregadores.component.{ts,html}
  historico/
    delivery-historico.component.{ts,html}
```

- `DeliveryStore` é `@Injectable()` provido em `providers` da página (escopo da rota), consumido pelos filhos via `inject`.
- Templates com `@if/@for`, tokens do tema (`bg-graphite-200`, `bg-graphite`, `border-white/10`, `text-white`, `accent`) que o `styles.css` já remapeia no tema claro. Nada de `bg-slate-50`, `indigo-*`, `bg-slate-800`.

### Rótulos e cores de status

| Status | Rótulo | Tom | Verbo da ação |
|---|---|---|---|
| AGENDADA | Agendada | slate | — |
| CHEGOU | Chegou | amber | Registrar chegada |
| AGUARDANDO_AUTORIZACAO | Aguardando autorização | sky | Pedir autorização ao morador |
| AUTORIZADA | Autorizada | emerald | Autorizar subida |
| RETIRADA_NA_PORTARIA | Retirada na portaria | violet | Deixar na portaria |
| CONCLUIDA | Concluída | emerald | Concluir |
| CANCELADA | Cancelada | slate | — |
| RECUSADA | Recusada | red | Recusar |

### Cabeçalho

Ícone em caixa arredondada (padrão de Ocorrências), título "Delivery", subtítulo, abas num controle segmentado com o ativo destacado em `accent`. "Histórico e relatório" continua visível só para síndico/admin.

### Aba Fila

- 4 cards (Agendada, Chegou, Aguardando autorização, Autorizada) com número na cor do status; clicar filtra, clicar de novo limpa; o card ativo ganha borda/anel na cor.
- Busca (unidade, nome, telefone, placa) + select de status (mantido, incluindo "Retirada na portaria").
- Grade `lg:grid-cols-5`: lista em 3 colunas, painel em 2.
- Item da lista: barra lateral na cor do status, estabelecimento, selo, "Bloco A 106 · entregador", modo (Na unidade / Na portaria), tempo de espera. Item selecionado destacado.
- Tempo de espera: base `chegou_em`, senão `created_at`. Para CHEGOU/AGUARDANDO_AUTORIZACAO, acima de 10 min o texto fica âmbar.
- Estados: carregando (spinner), vazio ("Nenhuma entrega na fila").
- Painel fixo; sem seleção mostra orientação "Selecione um atendimento para ver detalhes e agir".
- Painel com seleção: cabeçalho (#id, unidade, modo, selo), observação do morador, cartão do entregador, select de entregador + link "Cadastrar novo entregador", ações:
  - primária `accent`: Autorizar subida (desabilitada com dica se entregador ausente/bloqueado) ou Concluir / Registrar chegada quando forem a única via;
  - secundárias neutras: Pedir autorização ao morador, Deixar na portaria;
  - Recusar em vermelho; ao clicar abre o campo de motivo inline com "Confirmar recusa"/"Voltar".
  - linha do tempo.
- Atualização automática: a cada 20 s enquanto a aba Fila está ativa e `document.visibilityState === 'visible'`; não sobrescreve o motivo sendo digitado; mantém o atendimento aberto.
- A fila usa `escopo=ativos`; contadores vêm da própria lista ativa.

### Aba Entregadores

- Grade 2 colunas: à esquerda lista com busca (nome, placa, selo "Bloqueado" vermelho, telefone); à direita um formulário único que alterna entre "Novo entregador" e "Editar entregador" (edição só para síndico/admin) com botão "Cancelar edição".
- Campos de edição atuais preservados (nome, telefone, situação + motivo, veículo tipo/placa/modelo/cor, remover veículo).
- Cadastrar a partir do atendimento continua levando de volta à fila com o entregador selecionado.

### Aba Histórico (síndico/admin)

- Seletor de período: Hoje / 7 dias / 30 dias (padrão 7 dias).
- Cards do `/resumo`: Concluídos, Recusados, Cancelados, Tempo médio ("7 min" ou "—").
- Busca local na lista carregada (`escopo=historico`), lista com selo e data; painel com a linha do tempo do atendimento selecionado.

## Erros

- Faixa de erro única no casco, com botão de fechar; some ao trocar de aba.
- Falha no polling não apaga a lista atual; mostra a faixa.

## Testes

- API (`delivery.service.spec.ts`): `escopo=ativos`, `escopo=historico` com padrão de 30 dias e `ate` inclusivo, escopo inválido → 400, morador ignora escopo, `resumo` (contagens, média, `null` sem dados, 403 para morador).
- Front (Jest): `delivery-status`, `tempo-espera`, store (filtros/contadores/regras de autorização e recusa), fila (cards-filtro, painel vazio, ações), entregadores (alternância novo/editar), histórico (período chama API com datas). Specs atuais ajustados aos rótulos novos.
- Verificação visual com Playwright, temas claro e escuro, API e portaria-web rodando localmente; depois em produção após o deploy.

## Fora do escopo

Paginação do histórico além de 500, exportação de relatório, mudanças no app Flutter, mudanças de schema.
