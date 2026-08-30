# Plano de Implementação: Melhorias de Acessibilidade WCAG 2.1 & Contraste no ClickPrestare

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar as 4 melhorias pontuais de acessibilidade identificadas pelo Axe-Core (WCAG 2.1 AA): adicionar atributos `alt` em imagens e avatares, `aria-label` em botões de ícone sem texto visível, `aria-label` em selects e checkboxes, e ajuste de contraste de textos secundários no tema escuro (`text-slate-400` ➔ `text-slate-300`).

**Architecture:** Modificações nos templates HTML e componentes Angular em `click-cond-web/apps/portaria-web/src/app` aplicando atributos ARIA nativos e utilitários Tailwind coerentes com o design system existente.

**Tech Stack:** Angular 18+, TailwindCSS, HTML5 Semântico, WCAG 2.1 / Axe-Core Standards.

**Spec:** Baseado no relatório de auditoria `relatorio_avancado_clickprestare.md`.

## Global Constraints
- Manter 100% de compatibilidade visual e responsiva existente.
- Não alterar regras de negócio ou chamadas de API.
- Usar tags semânticas e atributos padrão W3C WAI-ARIA (`alt`, `aria-label`, `aria-hidden="true"`).
- Testar e validar com compilação e verificação de integridade.

---

### Task 1: Adicionar Atributo `alt` em Todas as Imagens e Avatares

**Files:**
- Modify: `click-cond-web/apps/portaria-web/src/app/dashboard/dashboard-page.component.html`
- Modify: `click-cond-web/apps/portaria-web/src/app/visitantes/visitantes-page.component.html`
- Modify: `click-cond-web/apps/portaria-web/src/app/moradores/moradores-page.component.html`
- Modify: `click-cond-web/apps/portaria-web/src/app/prestadores/prestadores-page.component.html`
- Modify: `click-cond-web/apps/portaria-web/src/app/encomendas/encomendas-page.component.html`

- [ ] **Passo 1: Adicionar `alt` descritivo nas fotos de eventos e avatares do Dashboard**
- [ ] **Passo 2: Adicionar `alt` descritivo em Visitantes, Moradores e Prestadores**
- [ ] **Passo 3: Verificar ausência de tags `<img>` sem `alt`**

---

### Task 2: Adicionar `aria-label` em Botões de Ícone (SVG sem Texto)

**Files:**
- Modify: `click-cond-web/apps/portaria-web/src/app/moradores/moradores-page.component.html`
- Modify: `click-cond-web/apps/portaria-web/src/app/visitantes/visitantes-page.component.html`
- Modify: `click-cond-web/apps/portaria-web/src/app/encomendas/encomendas-page.component.html`
- Modify: `click-cond-web/apps/portaria-web/src/app/veiculos/veiculos-page.component.html`
- Modify: `click-cond-web/apps/portaria-web/src/app/ocorrencias/ocorrencias-page.component.html`

- [ ] **Passo 1: Adicionar `aria-label` nos botões de paginação (Anterior / Próxima / Páginas)**
- [ ] **Passo 2: Adicionar `aria-label` nos botões de fechar modal e limpar busca**
- [ ] **Passo 3: Adicionar `aria-label` nos botões de ação por linha (Editar / Remover / Visualizar)**

---

### Task 3: Adicionar `aria-label` em Selects, Checkboxes e Filtros

**Files:**
- Modify: `click-cond-web/apps/portaria-web/src/app/encomendas/encomendas-page.component.html`
- Modify: `click-cond-web/apps/portaria-web/src/app/ocorrencias/ocorrencias-page.component.html`
- Modify: `click-cond-web/apps/portaria-web/src/app/moradores/moradores-page.component.html`
- Modify: `click-cond-web/apps/portaria-web/src/app/visitantes/visitantes-page.component.html`

- [ ] **Passo 1: Adicionar `aria-label` nos checkboxes de Encomendas**
- [ ] **Passo 2: Adicionar `aria-label` nos elementos `<select>` de filtros**

---

### Task 4: Melhorar Taxa de Contraste de Textos Secundários no Modo Escuro

**Files:**
- Modify: `click-cond-web/apps/portaria-web/src/app/dashboard/dashboard-page.component.html`
- Modify: `click-cond-web/apps/portaria-web/src/app/shell/sidebar.component.ts`
- Modify: `click-cond-web/apps/portaria-web/src/app/moradores/moradores-page.component.html`
- Modify: `click-cond-web/apps/portaria-web/src/app/visitantes/visitantes-page.component.html`

- [ ] **Passo 1: Ajustar legendas de data/hora e rótulos secundários (`text-slate-400` ➔ `text-slate-300`)**
- [ ] **Passo 2: Validar compilação do projeto Angular**
