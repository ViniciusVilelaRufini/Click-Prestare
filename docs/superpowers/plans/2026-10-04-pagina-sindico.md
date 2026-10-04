# Página para Síndicos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publicar a rota `/sindico/` para converter síndicos em pedidos de orçamento, no mesmo sistema visual e técnico da landing Prestare.

**Architecture:** A página será HTML estático sob `public/sindico/`, importando tokens e imagens reais por caminhos absolutos de `/sobre/`. Um formulário registra o lead no endpoint existente antes de abrir o WhatsApp. As três entradas “Para o síndico” da landing atual apontam para a nova rota.

**Tech Stack:** HTML, CSS/tokens Prestare, JavaScript do navegador, Jest 30 e Nx 22.

**Spec:** `docs/superpowers/specs/2026-10-04-pagina-sindico-design.md`

## Global Constraints

- Reutilizar `/sobre/_ds/...` e `/sobre/assets/...`; não criar paleta paralela ou mockup genérico.
- Usar o título “Gestão do condomínio sem consumir o seu dia.” e o CTA “Pedir orçamento para meu condomínio”.
- Mostrar visitantes, encomendas, comunicados, áreas sociais, financeiro e ocorrências sem prometer horas poupadas ou resultados não verificáveis.
- Registrar `pagina: '/sindico/#orcamento'` em `/api/public/leads` e abrir WhatsApp somente depois da validação.
- Manter um único `h1`, foco visível, `alt` descritivo e layout sem overflow entre 320px e desktop.
- Alterar somente os links “Para o síndico” — topo, rodapé e menu mobile — para `/sindico/`.

## Review Focus

- O build inclui `sindico/index.html`.
- Ambos os CTAs levam a `#orcamento`.
- Formulário inválido não chama `fetch` nem `window.open`; o válido registra a origem antes de abrir WhatsApp.
- As telas web usam caminhos absolutos `/sobre/assets/`.
- As três entradas “Para o síndico” deixam de apontar para `#console`.

---

### Task 1: Página estática e formulário de orçamento

**Files:**
- Create: `click-cond-web/apps/portaria-web/public/sindico/index.html`
- Create: `click-cond-web/apps/portaria-web/src/app/sindico-landing.spec.ts`

**Interfaces:**
- Consumes: tokens `/sobre/_ds/...`, imagens `/sobre/assets/web-{dashboard,visitantes,financeiro,autorizacao}.png`, API `POST /api/public/leads`.
- Produces: rota `/sindico/` e formulário `#orcamento` com origem `/sindico/#orcamento`.

- [ ] **Step 1: Write the failing test**

Create `sindico-landing.spec.ts` with a helper that reads `public/sindico/index.html`. Add these contract tests:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const pagePath = join(process.cwd(), 'apps/portaria-web/public/sindico/index.html');
const htmlDaPaginaSindico = () => readFileSync(pagePath, 'utf8');

it('publica a rota, mensagem central e dois CTAs de orçamento', () => {
  expect(existsSync(pagePath)).toBe(true);
  const html = htmlDaPaginaSindico();
  expect(html).toContain('<h1>Gestão do condomínio sem consumir o seu dia.</h1>');
  expect(html.split('Pedir orçamento para meu condomínio')).toHaveLength(3);
  expect(html).toContain('id="orcamento"');
});

it('mostra processos e telas reais do console', () => {
  const html = htmlDaPaginaSindico();
  ['Visitantes', 'Encomendas', 'Comunicados', 'Áreas sociais', 'Financeiro', 'Ocorrências'].forEach((t) => expect(html).toContain(t));
  ['web-dashboard.png', 'web-visitantes.png', 'web-financeiro.png', 'web-autorizacao.png'].forEach((a) => expect(html).toContain(`/sobre/assets/${a}`));
});
```

In the same test, extract the page’s lead script in JSDOM. Assert that an empty required field returns `false` with no `fetch`/`open`; a valid name, condominium and 10+ digit contact returns `true`, posts `pagina: '/sindico/#orcamento'`, and opens `https://wa.me/5517996608148`.

- [ ] **Step 2: Verify red**

Run: `npm exec nx test portaria-web --runInBand --testPathPattern=sindico-landing.spec.ts`

Expected: FAIL because `public/sindico/index.html` does not exist.

- [ ] **Step 3: Implement the page**

Create standalone `public/sindico/index.html`. Copy only the head dependencies needed from `/sobre/index.html`: viewport, favicon, canonical/OG metadata changed to `/sindico/`, and existing design-system stylesheets. Every design-system and image URL is absolute `/sobre/...`.

Implement this semantic structure:

```html
<main class="sindico-page">
  <section aria-labelledby="sindico-title"><h1>Gestão do condomínio sem consumir o seu dia.</h1>…</section>
  <section aria-label="Impactos na rotina">…três ganhos…</section>
  <section aria-labelledby="processos-title">…seis cards…</section>
  <section aria-labelledby="comparativo-title">…Antes e depois da Prestare…</section>
  <section aria-labelledby="console-title">…quatro figures reais…</section>
  <section id="orcamento" aria-labelledby="orcamento-title">…formulário e CTA final…</section>
</main>
```

The hero contains the approved supporting copy and one `href="#orcamento"`. The closing navy block contains `Seu tempo deve ir para decisões — não para tarefas repetitivas.` and another CTA to the same anchor. Use `h2`/`h3` after the single `h1`.

Add CSS scoped to `.sindico-page`, using existing blue tokens, technical grid, cards and focus style. Include:

```css
@media (max-width: 680px) {
  .sindico-page .sindico-hero,
  .sindico-page .sindico-comparison,
  .sindico-page .sindico-console-grid { grid-template-columns: 1fr; }
  .sindico-page .sindico-shell { padding-inline: 20px; }
}
```

Embed `window.psEnviarPedido`: validate nonempty `nome`, `condominio`, `contato` and 10–13 phone digits; `fetch(api + '/api/public/leads', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome, condominio, whatsapp: contato, pagina }) })`; then `window.open` WhatsApp. The submit handler prevents navigation, passes `/sindico/#orcamento`, and shows success only after the helper returns `true`.

- [ ] **Step 4: Verify green**

Run: `npm exec nx test portaria-web --runInBand --testPathPattern=sindico-landing.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run `git add apps/portaria-web/public/sindico/index.html apps/portaria-web/src/app/sindico-landing.spec.ts` then `git commit -m "feat(site): criar página para síndicos"`.

### Task 2: Navegação da landing para a rota dedicada

**Files:**
- Modify: `click-cond-web/apps/portaria-web/public/sobre/index.html:431-440`
- Modify: `click-cond-web/apps/portaria-web/public/sobre/index.html:1125-1133`
- Modify: `click-cond-web/apps/portaria-web/public/sobre/index.html:1173-1185`
- Modify: `click-cond-web/apps/portaria-web/src/app/sindico-landing.spec.ts`

**Interfaces:**
- Consumes: `/sindico/` from Task 1.
- Produces: header, footer and mobile-menu navigation to `/sindico/`.

- [ ] **Step 1: Write the failing navigation test**

Add this test:

```ts
it('leva as três entradas Para o síndico para a rota dedicada', () => {
  const landing = readFileSync(join(process.cwd(), 'apps/portaria-web/public/sobre/index.html'), 'utf8');
  const links = Array.from(landing.matchAll(/<a href="([^"]+)"[^>]*>Para o síndico<\/a>/g));
  expect(links).toHaveLength(3);
  expect(links.map(([, href]) => href)).toEqual(['/sindico/', '/sindico/', '/sindico/']);
});
```

- [ ] **Step 2: Verify red**

Run: `npm exec nx test portaria-web --runInBand --testPathPattern=sindico-landing.spec.ts`

Expected: FAIL because the paths are currently `#console`.

- [ ] **Step 3: Update the three intended anchors**

Replace the `href` in the header, footer and mobile anchor whose visible text is exactly `Para o síndico` with `/sindico/`. Preserve the mobile `onClick="{{ fecharMenu }}"`; do not alter `id="console"` or unrelated links.

- [ ] **Step 4: Verify green**

Run: `npm exec nx test portaria-web --runInBand --testPathPattern=sindico-landing.spec.ts`

Expected: PASS with exactly three visible “Para o síndico” links to `/sindico/`.

- [ ] **Step 5: Commit**

Run `git add apps/portaria-web/public/sobre/index.html apps/portaria-web/src/app/sindico-landing.spec.ts` then `git commit -m "feat(site): apontar navegação para página do síndico"`.

### Task 3: Regressão e inspeção visual

**Files:**
- Modify: `click-cond-web/apps/portaria-web/public/sindico/index.html` only for a verified defect.

**Interfaces:**
- Consumes: completed Tasks 1–2.
- Produces: build and test evidence for the public page.

- [ ] **Step 1: Build**

Run: `npm exec nx build portaria-web`

Expected: PASS and `dist/apps/portaria-web/browser/sindico/index.html` exists.

- [ ] **Step 2: Run the full suite**

Run: `npm exec nx test portaria-web --runInBand`

Expected: PASS; report any unrelated existing failure by name.

- [ ] **Step 3: Inspect the built public site**

Run `npm exec nx run portaria-web:serve-static`, then inspect `/sindico/` at 320px, 375px, 768px and desktop. Check CTA anchoring, all screenshots, visible keyboard focus, invalid-form block and no horizontal overflow.

- [ ] **Step 4: Fix only reproducible defects through red-green**

For a defect, first add a failing assertion to `sindico-landing.spec.ts`, verify red, make the smallest HTML/CSS/script change, and rerun focused plus full tests. If inspection is clean, do not change production code.

- [ ] **Step 5: Commit only if a correction was needed**

Run `git add apps/portaria-web/public/sindico/index.html apps/portaria-web/src/app/sindico-landing.spec.ts` then `git commit -m "fix(site): ajustar página para síndicos"`. Do not make an empty commit.
