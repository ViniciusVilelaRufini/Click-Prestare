# Redesign corporativo da landing Prestare

**Data:** 2026-09-28  
**Status:** aguardando revisão do usuário

## Objetivo

Reposicionar visualmente a landing pública em `/sobre/` como uma solução empresarial de gestão condominial e controle de acesso. A página deve transmitir precisão, confiança operacional e autoridade institucional.

## Escopo e restrições

- Alterar somente a apresentação: tema, paleta, tipografia, hierarquia, espaçamento, superfícies, CTAs, componentes e textos de interface/marketing.
- Preservar todas as informações, imagens, recursos, links, formulários, rastreamento, acessibilidade existente e comportamento responsivo.
- Não remover seções para simplificar a página nem trocar imagens atuais.
- Manter o azul da marca, complementado por azul-marinho institucional.

## Direção aprovada

O tema selecionado é **operacional**, com tom de escrita **direto e executivo**.

### Linguagem

- Títulos curtos e orientados a resultado, como “Controle para decidir. Visibilidade para agir.”
- Textos de apoio claros, concretos e profissionais; termos como acesso, rastreabilidade, operação, gestão e tempo real substituem formulações excessivamente genéricas.
- CTAs institucionais e objetivos, por exemplo “Solicitar uma demonstração” e “Pedir orçamento”.
- Blocos destinados especificamente ao morador podem preservar linguagem mais próxima, sem alterar o tom principal da página.

### Paleta e tipografia

| Papel | Cor |
| --- | --- |
| Azul institucional | `#102D57` |
| Azul de ação | `#2863CE` |
| Azul de apoio | `#EAF1FF` |
| Superfície técnica | `#F6F9FD` |
| Texto principal | `#1B2838` |

Será usada a família sans-serif já carregada pela landing/design system. Títulos terão peso alto, espaçamento compacto e escala clara; textos corridos terão tamanho e entrelinha voltados à leitura.

## Componentes e aplicação

### Navegação e hero

- Navegação branca, mais contida, com CTA azul retangular de baixo raio.
- Hero com fundo técnico muito claro e grade discreta, limitada à área de destaque.
- O material visual existente permanece; sua moldura, sombra e posicionamento passam a parecer parte de uma plataforma de operação.
- Estatísticas existentes recebem maior prioridade numérica e rótulos discretos.

### Seções internas

- Módulos, benefícios e recursos passam a usar cards funcionais: fundo branco, borda sutil, raio de 8px e sombra mínima.
- Ícones usam azul de ação sobre superfícies azul-claro.
- Seções de diferenciais, evidência, conversão e fechamento usam azul-marinho, dados e indicadores em alto contraste.
- Tabelas e comparativos recebem cabeçalho institucional, linhas calmas e foco explícito na oferta Prestare.
- Formulário e CTA final ganham hierarquia de conversão, preservando campos, validações e integração atuais.

### Mobile e acessibilidade

- Grades viram uma coluna sem esconder conteúdo.
- Botões preservam área de toque confortável.
- A implementação mantém contraste adequado, foco visível, labels e hierarquia semântica existentes.

## Fluxo e compatibilidade

O redesign é estático no nível de apresentação. Eventos de analytics, submissão de orçamento, modais, navegação por âncoras, links de download e carregamento de imagens continuam usando os mesmos atributos, identificadores e scripts. Não haverá mudança de endpoint, modelo de dados ou contrato externo.

## Arquivos previstos

| Arquivo | Mudança |
| --- | --- |
| `click-cond-web/apps/portaria-web/public/sobre/index.html` | Aplicar o tema e revisar a redação visível sem remover conteúdo ou scripts. |
| `click-cond-web/apps/portaria-web/public/sobre/_ds/prestare-design-system-ea5733ab-5826-4a69-b0f1-440d2f55154e/styles.css` | Aplicar estilos compartilhados de componentes quando isso reduzir regras locais duplicadas. |
| `click-cond-web/apps/portaria-web/public/sobre/_ds/prestare-design-system-ea5733ab-5826-4a69-b0f1-440d2f55154e/tokens/colors.css`, `typography.css`, `radius.css`, `elevation.css` | Atualizar os tokens usados pela landing, preservando os demais consumidores do design system. |

Antes de editar, a implementação identificará as regras que de fato controlam cada bloco para evitar sobrescrever estilos gerados ou assets não relacionados.

## Tratamento de falhas

- Se uma imagem não carregar, seu `alt` existente permanece e o layout não pode colapsar.
- Interações JavaScript existentes devem continuar funcionais sem depender das novas classes visuais.
- Em telas estreitas, cards e CTAs devem refluír sem transbordamento horizontal.

## Verificação

1. Servir `apps/portaria-web/public` localmente e inspecionar `/sobre/` em desktop e mobile.
2. Confirmar que imagens, links, âncoras, modal de imagens, formulário e CTAs continuam presentes e funcionais.
3. Executar a verificação/build relevante de `portaria-web` quando os estilos finais estiverem aplicados.
4. Revisar contraste, foco de teclado, overflow e console do navegador.
