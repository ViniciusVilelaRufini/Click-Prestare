# Card ao vivo do delivery — desenho

Data: 13/11/2026 · Status: rascunho para aprovação
Base: card ao vivo da portaria remota (`2026-11-13-card-ao-vivo-portaria-remota-design.md`), publicado e aprovado no aparelho (1.2.44).

## Intenção

O delivery é o caso que inspirou o card (iFood): o morador pediu comida, o entregador chega à portaria e o morador precisa saber **na hora** e, quando a portaria pede, **autorizar sem abrir o app**. Hoje cada mudança de status vira uma notificação solta com o título "Delivery". O card substitui essa sequência por um único cartão que acompanha a entrega até o fim, na tela de bloqueio e na Ilha Dinâmica (iPhone) e como notificação fixa (Android).

Escolha feita com o usuário (13/11): das ideias levadas do card para o resto do sistema, só o delivery cabe nas regras da Apple para Live Activity (começo e fim claros, minutos, iniciada por ação do usuário). Encomendas, ocorrências, reservas e mudanças ficaram de fora porque duram horas ou dias. Os próximos trabalhos, nesta ordem, são: (2) portaria web mostra se o aviso chegou ao morador; (3) foto nas notificações comuns.

## Objetivos

- Um card por entrega, aberto quando a portaria marca **CHEGOU**, atualizado a cada status e fechado no fim.
- **AUTORIZAR** e **RECUSAR** no card quando a portaria pede autorização (`AGUARDANDO_AUTORIZACAO`). AUTORIZAR exige desbloqueio; RECUSAR não (mesma regra do card da portaria).
- Foto do entregador no círculo quando a portaria o identificou e ele tem foto; senão, iniciais do estabelecimento.
- Mesmo padrão visual do card da portaria (Prestare Dark/claro conforme o tema do app, amarelo da marca em ação e progresso, cabe nos ~160 pt).
- Quem tem app antigo ou aparelho sem card continua recebendo as notificações de hoje, sem duplicar quando o card está aberto.

## Fora do escopo / anti-objetivos

- Card antes da chegada (`AGENDADA`): pode estar horas à frente; a Apple trata como abuso.
- Texto livre do morador ("estou descendo"): não existe no fluxo hoje.
- Avisar outros moradores da unidade: hoje só quem criou o aviso recebe; o card segue isso.
- Mudar a tela da portaria web: ela já atualiza a cada 20 s e mostra a resposta do morador.
- **Anti-objetivo:** card esquecido na tela. Se a entrega não terminar, o card fecha sozinho (ver Duração).

## Fases

| Status do delivery | Fase do card | Tag (cor do ponto) | Número à direita (rótulo) | Corpo |
|---|---|---|---|---|
| CHEGOU | `chegou` | NA PORTARIA (amarelo) | tempo desde a chegada, contando (NA PORTARIA) | etapas CHEGOU → AUTORIZADO → ENTREGUE (1ª feita); "Entregador chegou à portaria." |
| AGUARDANDO_AUTORIZACAO | `aguardando` | AGUARDANDO (amarelo) | tempo desde a chegada (NA PORTARIA) | botões RECUSAR / AUTORIZAR |
| AUTORIZADA | `autorizado` | AUTORIZADO (verde) | hora da autorização (AUTORIZADO) | etapas CHEGOU → AUTORIZADO → ENTREGUE; "A caminho da sua unidade." ou "Você autorizou. A caminho da sua unidade." |
| RETIRADA_NA_PORTARIA | `retirar` | NA PORTARIA (amarelo) | hora (AGUARDANDO VOCÊ) | etapas CHEGOU → NA PORTARIA → RETIRADO; "Sua entrega está na portaria. Retire quando puder." |
| CONCLUIDA | `entregue` | ENTREGUE (verde) | hora (ENTREGUE) | etapas completas; fica 5 min e some |
| RECUSADA | `recusado` | RECUSADO (vermelho) | hora (RECUSADO) | "Você recusou" / "Recusado pela portaria" + motivo; fica 2 min |
| CANCELADA | — | — | — | card some na hora |

Número que **conta para cima** desde a chegada (`Text(timerInterval:countsDown:false)`): o morador vê há quanto tempo o entregador espera, como no iFood. Não há prazo de resposta no delivery, então não há contagem regressiva nem barra que esvazia; a barra amarela aparece só como etapas.

## Conteúdo do card

- Cabeçalho: logo + "DELIVERY" + tag da fase.
- Linha principal: estabelecimento (ou "Delivery" se vazio).
- Subtítulo: entregador e plataforma quando identificados ("Carlos · iFood"), senão "Entregador"; mais a unidade ("Bloco A · Apto 106").
- Círculo: foto do entregador (miniatura, mesmo esquema da foto do visitante, mas no estado do card — ver decisão 2) ou iniciais do estabelecimento.
- Modo de entrega `PORTARIA` (morador vai buscar): após CHEGOU a fase natural é `retirar`; o card mostra isso.

## Comportamento

- **Abrir:** `DeliveryService.atualizarStatus` → CHEGOU chama o card (`origem: 'delivery'`) para os aparelhos do morador que criou o aviso. iPhone com token e `card_versao ≥ 2` → push-to-start; Android com app novo e `card_versao ≥ 2` → push de dados; resto → a notificação de hoje.
- **Atualizar:** cada mudança seguinte atualiza a fase nos cards abertos. A notificação de hoje (`notificarMorador`) só vai para aparelho **sem** card aberto daquele delivery.
- **Pular etapas:** a portaria pode ir de AGENDADA→CHEGOU→AUTORIZADA direto, ou abrir em `AGUARDANDO_AUTORIZACAO` logo após CHEGOU; o card aceita qualquer transição válida do delivery (se não houver card aberto quando chega um status não-terminal, ele abre ali).
- **Resposta pelo card:** AUTORIZAR → `PATCH /delivery/:id {status:'AUTORIZADA'}`; RECUSAR → `{status:'RECUSADA', motivo:'Recusado pelo morador'}` (o servidor exige motivo). Resposta recusada (409: a portaria já mudou o status) fecha o card no aparelho, como no card da portaria.
- **Reserva automática** (aparelho não confirmou o card em 10 s → notificação comum) e **confirmação** iguais ao card da portaria.
- **Duração:** card aberto há mais de 2 h sem chegar a um status final é encerrado pelo tique (limite da Apple é 8 h; entrega real dura minutos).
- **Logout** encerra os cards do usuário (já existe).

## Decisões tomadas na revisão do desenho (13/11)

1. **App antigo não recebe card de delivery.** Os apps 1.2.42–1.2.45 já têm card, mas desenhariam o delivery como portaria e os botões chamariam `/visitantes/:id/autorizar` com o id do delivery (pode bater com um visitante real). Nova coluna `Users_Devices.card_versao INT NOT NULL DEFAULT 1`; o app novo informa `card_versao: 2` no registro do aparelho; o card de delivery só vai para aparelho com versão ≥ 2. Os demais recebem a notificação de hoje. Os botões do iPhone e do Android passam a escolher a rota pela `origem` (portaria continua igual).
2. **Foto do entregador pode chegar depois da abertura** (a portaria marca CHEGOU e identifica o entregador em seguida). No delivery a foto vai no **estado** do card (`ContentState.foto`, opcional), reenviada em toda atualização enquanto houver; se o push passar de 3,9 KB, sai sem foto. No card da portaria nada muda (foto continua no atributo).
3. **Modo PORTARIA:** mapeamento 1:1 com o status; a fase `retirar` só existe quando o status é RETIRADA_NA_PORTARIA. AGUARDANDO_AUTORIZACAO pode ocorrer em qualquer modo (o servidor permite).
4. **Quais mudanças tocam/vibram:** `aguardando` (pedido de autorização) e `retirar` (o morador precisa descer) vão com alerta e som; as demais atualizam em silêncio. Abrir em CHEGOU também alerta (é a chegada). No Android, essas duas fases não usam `onlyAlertOnce`.
5. **Aparelho que não confirmou o card em 10 s** (recebeu a reserva) passa a ser tratado como **sem card** para aquele delivery: recebe a notificação de hoje em cada status seguinte.
6. **Notificação de hoje** mantém o alcance atual (`Users.fcm_token`, um aparelho) e só é suprimida quando esse aparelho tem card de delivery aberto e confirmado. Não amplia para todos os aparelhos.

## Visual

Mesmas peças do card da portaria (`CardVisual.swift`): paleta clara/escura pelo tema do app, Ilha sempre preta, cantos retos, Barlow Condensed nos rótulos, amarelo em AUTORIZAR, nas etapas feitas e no ponto de "na portaria". Orçamento de altura ≤ 154 pt. A prévia é aprovada junto com este documento; o plano não para no meio esperando outra aprovação visual. Prévia em `http://127.0.0.1:5180/delivery.html` (arquivo `delivery.html` na pasta de prévias do card, fora do repositório): seis fases nos dois temas, ilha expandida com RECUSAR/AUTORIZAR e ilha compacta com o tempo desde a chegada.

## Abordagens consideradas

- **A — motor do card generalizado (escolhida):** `Cards_Ao_Vivo.origem` ganha o valor `delivery`; mesmo tipo de Live Activity (`CardPortariaAttributes`), com campos opcionais novos no estado; o widget escolhe o layout pela `origem`; os botões chamam a rota certa pela `origem`. Reaproveita APNs, reserva, confirmação, tique, tabela e Android. Campos novos são opcionais, então cards da portaria e apps antigos não quebram.
- **B — card separado (`CardDeliveryAttributes`, módulo próprio):** duplicaria envio, reserva, confirmação, tique e tabela sem ganho; descartada.

## Restrições

- Push ≤ 4 KB (a foto já respeita); Live Activity sem rede; altura ≤ ~160 pt.
- Estado novo no `ContentState` só com campos **opcionais** (o iOS descarta em silêncio o push que não decodifica).
- Coluna `Cards_Ao_Vivo.origem` é `VARCHAR(10)`: `delivery` cabe.
- Sem publicação até o usuário mandar (pedido de 13/11: não subir ao TestFlight sem ordem).

## Decisões deixadas a quem implementa

- Nome exato dos campos novos do estado (ex.: `titulo`, `subtitulo`, `horaChegada`) e da `origem` no app.
- Como o widget separa os layouts (switch por `origem` dentro das mesmas views ou views irmãs).
- Texto exato das linhas de status, dentro do tom acima.
