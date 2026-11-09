# App — ajustes da varredura de design (09/11/2026)

## Por quê
A varredura de 09/11 no emulador (perfil morador, tema claro) achou telas que
fogem do padrão Prestare Dark/amarelo do resto do app. O objetivo é deixar
tudo com a mesma cara, sem mudar nenhum fluxo.

## Já resolvido (fora deste desenho)
- Título "MORADOR_NAV_EDIT" no editar perfil: chave `morador_nav_edit` nos 5
  idiomas + teste em `test/i18n_test.dart` (branch `feat/app-atalhos`).
- "FAB cobre o último item": alarme falso. `fabClearance()` já reserva o espaço;
  conferido rolando Encomendas e Financeiro até o fim.

## Mudanças
1. **GERENCIAR na tela do condomínio (`my_condominium.dart`, `_MenuRow`)** —
   escolha do usuário: **lista compacta (B)**. Um único bloco com fundo
   `surface` e borda `border`; linhas de ~56px (ícone 32px em `brandSoftOf`,
   sem borda própria, nome, seta), separadas por linha de 1px que começa depois
   do ícone. Some o espaço de 8px e a caixa individual de cada módulo. Ordem,
   contagem "N módulos" e navegação iguais.
2. **Prestare IA (`chat_ia_page.dart`)** — barra do topo deixa de ser bloco
   `primary` (preto): fundo da tela, título "PRESTARE IA" em
   `AppTypography.title` como no `AppScaffold`, botões com ícone em
   `textPrimary` sobre `surface` com borda. Sugestões: `ActionChip` com cantos
   retos e texto em `textPrimary`, borda `border` visível.
3. **Notificações (`notificacoes_page.dart`)** — filtros viram abas sublinhadas
   (mesmo visual das abas de Encomendas: texto caixa alta, sublinhado `brand`,
   contador entre parênteses). Seta à direita do cartão sem o círculo, como nas
   outras listas. A barra colorida lateral fica como está (cor por tipo, só nas
   não lidas).
4. **Início (`list_condominiums.dart`)** — reduzir o vão entre o cabeçalho
   "MEUS CONDOMÍNIOS" e o cartão para o mesmo espaçamento das outras seções.
5. **Editar perfil (`edit_morador.dart`)** — rótulos dos campos no tamanho e
   caixa das outras telas de formulário; "TELEFONE (OPCIONAL)" segue o mesmo
   formato dos demais.

## Abordagens consideradas (item 1)
- A) Grade 3 colunas: tudo em ~1,5 tela, mas nomes longos quebram. Recusada.
- **B) Lista compacta: mantém a leitura em lista, menos altura.** Escolhida.

## Fora do escopo
Telas de síndico/funcionário, tema escuro e telas internas dos módulos (ficam
para uma segunda varredura). Limpeza de cores fixas, `primaryLight` e tamanhos
de fonte fixos fica para quando cada tela for mexida.

## Restrições
Sem mudar fluxos ou textos além dos citados; testes existentes continuam
passando; conferir cada tela no emulador nos temas claro e escuro.

## Fase 2 — cartões dos módulos com imagem em degradê (aprovado 09/11)
Pedido: cada módulo do GERENCIAR com uma imagem bem trabalhada (Higgsfield) que
se dissolve em degradê dentro do cartão, como a foto do morador no console web.
- Estilo (escolha do usuário: "degradê"): objeto 3D por módulo, corpo no
  degradê da marca #FFD966→#F2A900 com detalhes pretos, luz de estúdio, fundo
  escuro, mesmo prompt-base em todos. Modelo: Z Image (único liberado no plano
  free da conta).
- Cartão: um por módulo, ~72dp; imagem ~96dp à esquerda de ponta a ponta,
  dissolvendo para a direita na cor do cartão (ShaderMask); nome e seta à
  direita. Material próprio por cartão, para o efeito de toque aparecer.
- Antes de gerar os 18: 3 amostras (Mudança, Áreas Sociais, Comunicados)
  conferidas pelo usuário no emulador.
- Abordagens: A) objeto 3D (escolhida), B) cena fotográfica (recusada:
  inconsistente entre os 18).
