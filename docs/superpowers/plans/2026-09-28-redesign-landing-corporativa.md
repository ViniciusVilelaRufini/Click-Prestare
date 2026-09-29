# Redesign corporativo da landing Prestare Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar à landing `/sobre/` uma identidade operacional e corporativa, preservando todo conteúdo, imagens reais e comportamento atual.

**Architecture:** A página é um documento estático orientado por tokens do design system e por estilos inline. O trabalho concentra a linguagem corporativa em tokens e em uma camada final de CSS local com seletores `ps-*`, depois ajusta apenas o texto visível de marketing e as superfícies dos blocos existentes. Scripts, bindings `{{ }}`, URLs, assets e estrutura de dados não mudam.

**Tech Stack:** HTML estático, CSS custom properties, Prestare Design System, `_ds_bundle.js`, Python `http.server`, agent-browser e Nx.

**Spec:** `docs/superpowers/specs/2026-09-28-redesign-landing-corporativa-design.md`

## Global Constraints

- Preservar todas as informações, imagens, recursos, links, formulários, rastreamento, acessibilidade existente e comportamento responsivo.
- Não remover seções nem trocar as imagens atuais.
- Manter em destaque as imagens reais do app do morador, app da portaria e sistema web; não usar ilustrações ou mockups genéricos em seu lugar.
- Usar tema operacional e escrita direta/executiva.
- Validar a página em 320px, 375px, 768px e desktop.
- Não alterar endpoints, bindings `{{ }}`, nomes/IDs dos formulários, scripts de analytics ou a integração com WhatsApp/CRM.

## Review Focus

- Viewport de 320px: logo, menu, CTA e barra fixa não podem criar overflow horizontal; validar na Tarefa 1.
- Telas reais em 375px: imagens de app e web devem continuar legíveis, proporcionais e abrir no modal; validar na Tarefa 3.
- Link com parâmetros de campanha: `?gclid=teste` deve continuar carregando e a submissão deve manter a função `psRegistrarLead`; validar na Tarefa 4.
- Formulário inválido: campos obrigatórios continuam bloqueando o envio nativo; validar na Tarefa 4.
- Teclado: foco de link, input e CTA permanece perceptível após trocar cores; validar na Tarefa 5.

---

## File structure

| Arquivo | Responsabilidade |
| --- | --- |
| `click-cond-web/apps/portaria-web/public/sobre/index.html` | Conteúdo público, markup, responsividade específica e scripts já existentes. Recebe a camada visual local e a redação aprovada. |
| `click-cond-web/apps/portaria-web/public/sobre/_ds/prestare-design-system-ea5733ab-5826-4a69-b0f1-440d2f55154e/tokens/colors.css` | Tokens de cor corporativos usados pelos componentes do design system. |
| `click-cond-web/apps/portaria-web/public/sobre/_ds/prestare-design-system-ea5733ab-5826-4a69-b0f1-440d2f55154e/tokens/radius.css` | Raios menos lúdicos para componentes compartilhados. |
| `click-cond-web/apps/portaria-web/public/sobre/_ds/prestare-design-system-ea5733ab-5826-4a69-b0f1-440d2f55154e/tokens/elevation.css` | Elevação mais técnica e controlada. |

### Task 1: Criar a fundação visual corporativa e proteger o mobile

**Files:**
- Modify: `click-cond-web/apps/portaria-web/public/sobre/_ds/prestare-design-system-ea5733ab-5826-4a69-b0f1-440d2f55154e/tokens/colors.css`
- Modify: `click-cond-web/apps/portaria-web/public/sobre/_ds/prestare-design-system-ea5733ab-5826-4a69-b0f1-440d2f55154e/tokens/radius.css`
- Modify: `click-cond-web/apps/portaria-web/public/sobre/_ds/prestare-design-system-ea5733ab-5826-4a69-b0f1-440d2f55154e/tokens/elevation.css`
- Modify: `click-cond-web/apps/portaria-web/public/sobre/index.html:105-256`

**Interfaces:**
- Consumes: tokens `--surface-*`, `--text-*`, `--border-*`, `--radius-*` e `--shadow-*` carregados no `<helmet>`.
- Produces: os tokens corporativos e classes locais `.ps-corporate-*` que as tarefas 2 e 3 aplicam sem modificar scripts.

- [ ] **Step 1: Capturar o estado de falha/referência em 320px e desktop**

Run:

```powershell
python -m http.server 8765 --directory click-cond-web/apps/portaria-web/public
$env:AGENT_BROWSER_SESSION = agent-browser session id --scope worktree --prefix prestare-redesign
agent-browser open http://localhost:8765/sobre/
agent-browser screenshot artifacts/landing-before-desktop.png --full-page
agent-browser viewport 320 800
agent-browser screenshot artifacts/landing-before-320.png --full-page
```

Expected: imagens de referência capturadas; a página atual ainda tem visual clean e não a hierarquia corporativa requerida.

- [ ] **Step 2: Atualizar tokens semânticos para a paleta operacional**

Em `colors.css`, manter os nomes existentes e alterar apenas os valores usados pela landing:

```css
--prestare-blue-900:#102d57;
--prestare-blue-700:#1a4eaa;
--prestare-blue-600:#245cc7;
--prestare-blue-500:#2863ce;
--prestare-blue-50:#eaf1ff;
--surface-app:#f6f9fd;
--text-strong:#1b2838;
--border-subtle:#dbe4ee;
```

Em `radius.css` e `elevation.css`, conservar os tokens, mas reduzir raios e usar sombras neutras curtas:

```css
--radius-lg:14px;
--radius-xl:18px;
--shadow-card:0 4px 14px rgba(16,45,87,.07);
--shadow-floating:0 14px 34px rgba(16,45,87,.14);
```

- [ ] **Step 3: Adicionar a camada local de layout e segurança responsiva**

No final do `<style>` de `index.html`, adicionar regras com os seletores existentes, sem remover os media queries atuais:

```css
.ps-hero { background:linear-gradient(120deg,#f7faff,#eaf1f9) !important; }
.ps-hero::before { content:""; position:absolute; inset:0; pointer-events:none; background-image:linear-gradient(rgba(40,99,206,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(40,99,206,.07) 1px,transparent 1px); background-size:40px 40px; mask-image:linear-gradient(90deg,#000,transparent 72%); }
.ps-hero > * { position:relative; }
@media (max-width:560px) { .ps-hero::before { background-size:32px 32px; } }
```

- [ ] **Step 4: Verificar a fundação e o overflow**

Run:

```powershell
agent-browser viewport 320 800
agent-browser open http://localhost:8765/sobre/
agent-browser eval "document.documentElement.scrollWidth === document.documentElement.clientWidth"
agent-browser viewport 1440 900
agent-browser screenshot artifacts/landing-foundation-desktop.png --full-page
```

Expected: avaliação retorna `true`; fundo, bordas e sombras comunicam maior densidade corporativa.

- [ ] **Step 5: Commit**

```powershell
git add click-cond-web/apps/portaria-web/public/sobre/index.html click-cond-web/apps/portaria-web/public/sobre/_ds/prestare-design-system-ea5733ab-5826-4a69-b0f1-440d2f55154e/tokens/colors.css click-cond-web/apps/portaria-web/public/sobre/_ds/prestare-design-system-ea5733ab-5826-4a69-b0f1-440d2f55154e/tokens/radius.css click-cond-web/apps/portaria-web/public/sobre/_ds/prestare-design-system-ea5733ab-5826-4a69-b0f1-440d2f55154e/tokens/elevation.css
git commit -m "feat(landing): estabelecer tema operacional corporativo"
```

### Task 2: Reposicionar navegação, hero, métricas e redação principal

**Files:**
- Modify: `click-cond-web/apps/portaria-web/public/sobre/index.html:261-340`

**Interfaces:**
- Consumes: tokens e camada `.ps-hero` da Tarefa 1; links e IDs atuais.
- Produces: primeira dobra corporativa, mantendo os mesmos destinos de navegação e imagens do hero.

- [ ] **Step 1: Localizar a cópia atual e confirmar que nenhum binding será removido**

Run:

```powershell
rg -n "Todo o condomínio|na palma da mão|Quero um orçamento|Ver os módulos|app-ia.png|app-home.jpeg" click-cond-web/apps/portaria-web/public/sobre/index.html
```

Expected: cada elemento existe antes da edição; URLs de imagens e atributos `onClick` são registrados para permanecerem no arquivo.

- [ ] **Step 2: Aplicar a redação direta/executiva preservando a informação**

Trocar somente texto visível no hero e CTAs equivalentes. Exemplo de direção:

```html
<h1>Controle para decidir.<br><span>Visibilidade para agir.</span></h1>
<p>Centralize visitantes, encomendas e a rotina do condomínio em uma operação segura, rastreável e acessível em tempo real.</p>
```

Não alterar `href`, `id`, `onClick`, `target`, `rel`, `data-*`, `name` ou `{{ }}` dos elementos existentes.

- [ ] **Step 3: Aplicar a hierarquia institucional à navegação e aos indicadores**

Usar os elementos existentes: CTA de navegação com fundo `--prestare-blue-500`, botões secundários sem preenchimento, estatísticas com número em azul e rótulo em `--text-muted`. Manter a navegação compacta em desktop e o menu `.ps-menu-btn` abaixo de 900px.

```css
.ps-hdr { background:rgba(255,255,255,.94) !important; border-bottom:1px solid var(--border-row); }
.ps-hero h1 { color:var(--text-strong); letter-spacing:-.055em; }
.ps-hero h1 span { color:var(--prestare-blue-500); }
```

- [ ] **Step 4: Verificar conteúdo e CTA em 375px e desktop**

Run:

```powershell
agent-browser viewport 375 812
agent-browser open http://localhost:8765/sobre/
agent-browser snapshot -i
agent-browser viewport 1440 900
agent-browser screenshot artifacts/landing-hero-desktop.png
```

Expected: “Pedir orçamento”, menu móvel e CTA de rodapé continuam disponíveis; nenhum texto é truncado.

- [ ] **Step 5: Commit**

```powershell
git add click-cond-web/apps/portaria-web/public/sobre/index.html
git commit -m "feat(landing): aplicar hierarquia executiva ao hero"
```

### Task 3: Aplicar superfícies corporativas aos módulos sem perder telas reais

**Files:**
- Modify: `click-cond-web/apps/portaria-web/public/sobre/index.html:341-690`

**Interfaces:**
- Consumes: assets atuais em `/sobre/assets/`, `.ps-telas` e `abrirImagem`/modal existentes.
- Produces: cards funcionais, blocos institucionais de contraste e imagens reais preservadas em desktop e celular.

- [ ] **Step 1: Registrar o conjunto obrigatório de imagens reais**

Run:

```powershell
rg -n "app-(ia|home|visitantes|encomendas|financeiro)|porteiro-(inicio|mudancas|comunicados|ocorrencias)|web-(autorizacao|visitantes|financeiro|dashboard)" click-cond-web/apps/portaria-web/public/sobre/index.html
```

Expected: todas as referências continuam presentes antes e depois da tarefa; não alterar seus `src`, `alt` ou `onClick`.

- [ ] **Step 2: Reestilizar seções e cards sem trocar sua estrutura**

Adicionar classes locais aos wrappers de seções existentes e CSS para alternar entre superfícies `--surface-card` e uma classe institucional azul-marinho. Aplicar borda de 1px, `--radius-lg` e `--shadow-card`; reservar fundo azul-marinho a diferenciais e CTAs, mantendo as imagens reais sobre superfícies claras.

```css
.ps-corporate-card { border:1px solid var(--border-subtle); border-radius:var(--radius-lg); box-shadow:var(--shadow-card); background:var(--surface-card); }
.ps-corporate-inverse { background:var(--prestare-blue-900); color:var(--text-on-brand); }
.ps-corporate-inverse p { color:var(--text-on-brand-muted); }
```

- [ ] **Step 3: Garantir leitura das galerias de telas reais no celular**

Preservar `.ps-telas`; complementar o media query atual com padding de fim e dimensões que não deformem fotografia/tela:

```css
@media (max-width:720px) {
  .ps-telas { scroll-padding-inline:18px; }
  .ps-telas img { width:100%; height:auto; object-fit:contain; }
}
```

- [ ] **Step 4: Validar imagem, modal e galeria em 375px**

Run:

```powershell
agent-browser viewport 375 812
agent-browser open http://localhost:8765/sobre/#app
agent-browser get count "img[src*='/sobre/assets/']"
agent-browser snapshot -i
```

Depois, clicar em uma tela real pelo `@eN` devolvido pelo snapshot, reexecutar `agent-browser snapshot -i` e fechar o modal.

Expected: contagem é maior que zero, a tela abre no modal e a página continua com largura igual à viewport.

- [ ] **Step 5: Commit**

```powershell
git add click-cond-web/apps/portaria-web/public/sobre/index.html
git commit -m "feat(landing): destacar módulos e telas reais"
```

### Task 4: Preservar conversão, formulário, FAQ, cookies e rodapé

**Files:**
- Modify: `click-cond-web/apps/portaria-web/public/sobre/index.html:691-1070`

**Interfaces:**
- Consumes: `#ps-form-demo`, `enviar`, `psConversaoOrcamento`, `psRegistrarLead`, estado de cookies e links atuais.
- Produces: fechamento corporativo que mantém toda conversão e interatividade inalteradas.

- [ ] **Step 1: Conferir interfaces de conversão antes da edição**

Run:

```powershell
rg -n "ps-form-demo|enviar|psConversaoOrcamento|psRegistrarLead|aceitarCookies|rejeitarCookies|linkWhatsapp" click-cond-web/apps/portaria-web/public/sobre/index.html
```

Expected: as interfaces aparecem no markup e nos scripts; nenhuma delas será renomeada.

- [ ] **Step 2: Aplicar o acabamento corporativo aos blocos finais**

Atualizar somente fundos, bordas, títulos e microcopy visível de FAQ, download, formulário e rodapé. O formulário permanece com os mesmos quatro campos, nomes, `required`, honeypot e botão submit.

```css
#contato { background:linear-gradient(135deg,var(--prestare-blue-900),#173f73); }
#contato h2, #contato h3 { color:var(--text-on-brand); }
#contato form { background:var(--surface-card); border-radius:var(--radius-lg); }
```

- [ ] **Step 3: Executar os testes funcionais de conversão e privacidade**

Run:

```powershell
agent-browser viewport 375 812
agent-browser open "http://localhost:8765/sobre/?gclid=teste#contato"
agent-browser snapshot -i
agent-browser eval "Boolean(window.psConversaoOrcamento) && Boolean(window.psRegistrarLead)"
agent-browser click "[aria-label='Preferências de cookies']"
agent-browser snapshot -i
```

Expected: expressão retorna `true`; banner/painel de cookies abre sem ficar sob a barra móvel; submissão vazia mostra validação nativa dos campos obrigatórios.

- [ ] **Step 4: Commit**

```powershell
git add click-cond-web/apps/portaria-web/public/sobre/index.html
git commit -m "feat(landing): finalizar conversão no tema corporativo"
```

### Task 5: Verificação final, acessibilidade e build

**Files:**
- Modify: nenhum, salvo correção necessária descoberta nesta tarefa em `index.html` ou nos tokens das tarefas anteriores.

**Interfaces:**
- Consumes: landing concluída e servidor local.
- Produces: evidência de layout responsivo, interações preservadas, build de `portaria-web` e captura final.

- [ ] **Step 1: Rodar a matriz de viewports e checar overflow**

Run:

```powershell
foreach ($viewport in @('320 800','375 812','768 1024','1440 900')) {
  $wh = $viewport.Split(' '); agent-browser viewport $wh[0] $wh[1]
  agent-browser open http://localhost:8765/sobre/
  agent-browser eval "document.documentElement.scrollWidth === document.documentElement.clientWidth"
}
```

Expected: `true` nas quatro larguras.

- [ ] **Step 2: Testar foco e navegação por teclado**

Run:

```powershell
agent-browser viewport 375 812
agent-browser open http://localhost:8765/sobre/
agent-browser press Tab
agent-browser press Tab
agent-browser screenshot artifacts/landing-focus-375.png
```

Expected: elemento focado tem foco visível e segue legível sobre o novo fundo.

- [ ] **Step 3: Executar build da aplicação que publica os assets**

Run:

```powershell
cd click-cond-web
npx nx build portaria-web
```

Expected: processo sai com código 0.

- [ ] **Step 4: Capturar a entrega e revisar o diff**

Run:

```powershell
agent-browser viewport 1440 900
agent-browser open http://localhost:8765/sobre/
agent-browser screenshot artifacts/landing-corporativa-final.png --full-page
git diff HEAD~4..HEAD --check
git status --short
```

Expected: captura mostra o tema corporativo; `git diff --check` não reporta erros; status não inclui artefatos temporários.

- [ ] **Step 5: Commit de correções de verificação, se houver**

```powershell
git add click-cond-web/apps/portaria-web/public/sobre/index.html click-cond-web/apps/portaria-web/public/sobre/_ds/prestare-design-system-ea5733ab-5826-4a69-b0f1-440d2f55154e/tokens
git commit -m "fix(landing): corrigir revisão responsiva"
```

Somente executar este commit se os passos 1 a 4 exigirem uma correção de código.

