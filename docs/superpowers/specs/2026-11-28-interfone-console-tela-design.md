# Tela Interfone do console — reorganização e 4 funções novas

Data: 28/11/2026 · Tamanho: mudança pequena-média (console + ajuste pequeno na API)

## Por quê

A página `/interfone` do console (portaria-web), separada do dashboard em 9def2848, ficou crua: o painel "Ligar"
é só um campo de busca com a coluna vazia embaixo, o resultado da chamada (Falha, Recusada, Atendida) é texto cinza
no meio da legenda, a etiqueta "Portão aberto" corta o nome de quem atendeu e o porteiro não vê se o console está
pronto para receber chamadas. O dono pediu para melhorar visual e estrutura e aprovou quatro funções novas.

## Objetivos

1. **Topo da página**: título + selo de estado do console ("Pronto para receber chamadas" verde; ou o motivo de
   `store.semChamadas()` / `somBloqueado()` em âmbar/vermelho).
2. **Números do dia** (`ps-kpis`): Total · Atendidas (morador ou portaria) · Sem resposta (não atendida, recusada,
   desligou antes) · Falhas · Portões abertos. Contados no navegador a partir da lista exibida.
3. **Lista de chamadas** reorganizada:
   - filtro segmentado `Todas | Atendidas | Sem resposta | Falhas` (`ps-seg`), aplicado no navegador;
   - linha: hora em coluna fixa à esquerda · foto 40 px (ou ícone do tipo) · unidade em destaque + tipo com ícone
     de direção · etiqueta colorida do resultado (verde atendida, âmbar sem resposta, vermelha falha, neutra em
     andamento) · segunda linha com quem atendeu e "Portão aberto por X" sem cortar.
4. **Ligar de volta**: botão "Ligar" em cada linha que tenha unidade; segue as mesmas travas do painel Ligar
   (em chamada, discando, atendendo).
5. **Foto ampliada**: clicar na foto abre um modal (`ps-modal`) com a foto grande, unidade, hora e resultado; fecha
   com Esc, clique fora ou botão.
6. **Unidades frequentes**: com a busca vazia, o painel "Ligar" lista até 5 unidades mais chamadas hoje (contagem
   sobre a lista de hoje), cada uma com "Ligar". Sem chamadas hoje, mostra uma dica de como buscar.
7. **Dias anteriores**: seletor de data no cabeçalho da lista (hoje até 30 dias para trás). Em outro dia a lista
   e os números passam a ser daquele dia, sem atualização ao vivo, com faixa "Vendo dd/mm · Voltar para hoje".
   "Ligar de volta" continua disponível; "Unidades frequentes" segue contando só hoje.

## Fora do escopo

- App do morador, painel de chamada tocando (`painel-chamada`), configurações do interfone.
- Busca por unidade no histórico, exportar, intervalo de datas.
- Nada muda no fluxo de atender/ligar/abrir portão.

## Não pode acontecer

- A lista de hoje (`store.hoje`) deixar de reconciliar o toque: ela continua sendo só "hoje" e não é trocada pela
  lista do dia escolhido.
- Porteiro ver chamadas de outro condomínio ou de mais de 30 dias.

## Abordagens consideradas

1. **Rota nova para dias passados** (escolhida). `GET /interfone/portaria/dia?data=AAAA-MM-DD`, mesma forma do
   item de hoje. A lista de hoje e a reconciliação do toque ficam intactas; o dia escolhido vive num sinal
   separado da tela.
2. Rota de hoje aceitando data: menos código na API, mas a mesma lista teria dois papéis (exibir e reconciliar o
   toque) e um engano faz o console tocar ou parar na hora errada.
3. Página de histórico com intervalo e busca: maior do que o pedido.

## Decisões

- **API** (`interfone-acoes.service.ts` / `interfone-portaria.controller.ts`):
  - item do console ganha `id_apartamento` (pode ser null) e `porta_aberta_por_nome`;
  - `hoje()` e o novo `dia(idCondominio, data)` usam a mesma consulta com intervalo do dia em Brasília;
  - `data` inválida, futura ou com mais de 30 dias → 400; mesmo `assertModulo` e mesmo limite de 200 itens.
- **Console**: `interfone-page` ganha cabeçalho com selo e números; `chamadas-hoje` passa a receber a lista e o
  modo (hoje/dia passado) e emite "ligar" e "ver foto"; `ligar-unidade` ganha a seção de frequentes. Cálculos
  (números, filtro, frequentes) em funções puras testadas.
- Visual estritamente nas classes do tema Prestare Dark (`ps-*`), claro e escuro.
- 30 dias = mesmo limite do histórico do app do morador (foto do visitante é dado pessoal; a foto some em 90 dias).
- "Ligar de volta" e "Unidades frequentes" usam `store.ligar(id_apartamento, unidade)`, que já existe.

## Fica a critério de quem implementa

Ícones exatos, espaçamentos, quebra em telas estreitas (uma coluna abaixo de `lg`), texto das dicas.
