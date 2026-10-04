# Página pública para síndicos

**Data:** 2026-10-04  
**Status:** aprovado para planejamento

## Objetivo

Criar uma página pública independente para síndicos na rota `/sindico/`. Ela deve converter o interesse desse público em pedidos de orçamento, comunicando ganhos reais de tempo e autonomia operacional proporcionados pelo app Prestare e pelo console web.

## Público e mensagem

O público são síndicos profissionais ou moradores que exercem a sindicância e acumulam tarefas administrativas e operacionais. A mensagem central é:

> Gestão do condomínio sem consumir o seu dia.

A página deve explicar que a Prestare centraliza processos recorrentes e torna a operação visível, reduzindo a dependência de ligações, mensagens, controles em papel e consultas dispersas. Não deve prometer uma quantidade específica de horas economizadas nem resultados não verificáveis.

## Direção visual

A página reutilizará integralmente a linguagem estabelecida em `/sobre/`:

- azul institucional, azul de ação, azul-claro de apoio e azul-marinho nos blocos de contraste;
- fundo técnico claro com grade discreta no hero e superfícies claras no conteúdo;
- tipografia, raio, sombras, cards, botões, estados de foco e breakpoints do design system existente;
- imagens reais existentes do console web e do app, sem mockups genéricos;
- layout responsivo em uma coluna em telas estreitas, sem ocultar conteúdo essencial.

## Estrutura e conteúdo

### Navegação

- Reutilizar a navegação e o rodapé da landing atual.
- O item “Para o síndico” passa a apontar para `/sindico/`; o mesmo vale para o link correspondente no rodapé e no menu mobile.
- O CTA de navegação permanece “Pedir orçamento” e leva ao formulário/âncora de orçamento da própria página.

### Hero

- Eyebrow: “Para síndicos”.
- Título: “Gestão do condomínio sem consumir o seu dia.”
- Texto de apoio: “Acompanhe tudo pelo app e pelo sistema web, reduza tarefas repetitivas e tome decisões com informação em tempo real.”
- CTA primário: “Pedir orçamento para meu condomínio”.
- CTA deve ter alto contraste, rótulo explícito, seta direcional e levar diretamente ao formulário de orçamento.
- A composição visual apresenta telas reais do console e/ou app já disponíveis nos assets da landing.

### Faixa de impacto

Logo após o hero, apresentar três efeitos operacionais:

1. Menos mensagens e ligações para resolver o básico.
2. Informações e pendências centralizadas.
3. Operação acompanhada de onde o síndico estiver.

### Processos que deixam de depender do síndico

Uma grade de cards apresenta os fluxos que a plataforma organiza: visitantes, encomendas, comunicados, áreas sociais, financeiro e ocorrências. Cada card deve ligar o recurso ao ganho prático de reduzir controles manuais e consultas espalhadas.

### Comparativo operacional

Um bloco visual “Antes e depois da Prestare” compara, sem dados inventados:

- anotações, mensagens e consultas manuais;
- informação centralizada, histórico acessível e acompanhamento pelo app/console.

O tratamento deve favorecer legibilidade e equivalência visual com os cards e superfícies do site atual, sem desqualificar alternativas de maneira exagerada.

### Console web

Uma seção dedicada evidencia as telas reais do sistema web e explica os benefícios de visão geral, histórico e relatórios. Deve reutilizar assets existentes como `web-dashboard.png`, `web-visitantes.png`, `web-financeiro.png` e `web-autorizacao.png`, preservando `alt` descritivo.

### Conversão final

Em fundo azul-marinho, fechar com:

- Título: “Seu tempo deve ir para decisões — não para tarefas repetitivas.”
- Texto de apoio breve, convidando o síndico a avaliar a Prestare para o seu condomínio.
- CTA primário: “Pedir orçamento para meu condomínio”.

O CTA final aponta ao mesmo formulário de orçamento da página; o formulário continua com validações, captura de lead e feedback já adotados na landing pública.

## Implementação e compatibilidade

- Criar `click-cond-web/apps/portaria-web/public/sindico/index.html` como página estática pública, com os assets compartilhados da landing carregados por caminhos corretos a partir da nova rota.
- Reaproveitar os tokens e CSS do design system sob `public/sobre/_ds/...` em vez de criar uma nova paleta paralela.
- Reaproveitar o fluxo de envio de orçamento e sua instrumentação atual, com `pagina` identificando `/sindico/` e a âncora quando aplicável.
- Atualizar os links “Para o síndico” em `public/sobre/index.html` para a nova rota. Não alterar links, formulários ou funcionalidades não relacionados.
- A página deve funcionar mesmo se imagens não carregarem: preservar texto alternativo, dimensões/layout estáveis e acesso ao CTA.

## Acessibilidade e responsividade

- Usar apenas um `h1`, seguida de hierarquia semântica de seções e títulos.
- Botões e links devem ter foco visível e área de toque adequada.
- Garantir contraste suficiente em botões, faixa escura, textos secundários e comparativo.
- Revisar as larguras de 320px, 375px, 768px e desktop, sem rolagem horizontal nem CTAs inacessíveis.

## Verificação

1. Criar testes que comprovem a existência da nova página, seu título/CTA principal, a referência aos assets reais e o formulário de pedido de orçamento.
2. Executar os testes novos em estado vermelho antes de criar o HTML e verificar a falha pela ausência da rota/conteúdo.
3. Executar a suíte relevante do projeto via Nx depois da implementação.
4. Servir o diretório público localmente e conferir `/sindico/` em desktop e nas quatro larguras definidas.
5. Conferir os links “Para o síndico” da landing, do rodapé e do menu mobile, além do envio de lead com origem `/sindico/`.
6. Fazer inspeção de foco de teclado, contraste, textos alternativos, console do navegador e overflow horizontal.
