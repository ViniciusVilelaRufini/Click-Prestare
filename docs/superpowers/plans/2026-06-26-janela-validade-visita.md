# Janela de Validade na Nova Visita e Liberação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o operador defina, ao criar uma "Nova Visita" e ao "Liberar Visitante" (dashboard), o **apartamento** e a **janela de validade** (data/hora de início e término) do acesso — que já é gravada no aparelho (ValidFrom/ValidTo) e barra o visitante expirado fisicamente.

**Architecture:** Mudança **só de frontend**. O backend já aceita e grava `data_hora_inicio`/`data_hora_termino`: `VisitantesController.novaVisitaPessoa` → `VisitantesService.novaVisitaParaPessoa` → `create({..., data_hora_inicio, data_hora_termino})`. `CreateVisitante` (modelo do front) e o service `novaVisitaPessoa(idRef, { id_apartamento, data_hora_inicio?, data_hora_termino? })` já têm os campos. Os dois formulários apenas não renderizam os inputs nem os enviam.

**Tech Stack:** Angular standalone components (signals, control flow `@if`), Tailwind, inputs `datetime-local`.

---

### Task 1: Helper de data/hora local (formato datetime-local)

**Files:**
- Modify: `click-cond-web/apps/portaria-web/src/app/visitantes/visitantes-page.component.ts`
- Modify: `click-cond-web/apps/portaria-web/src/app/dashboard/dashboard-page.component.ts`

`datetime-local` exige o valor no formato `YYYY-MM-DDTHH:mm` em hora LOCAL. Cada componente precisa de um helper para o default (agora e agora+4h).

- [ ] **Step 1: Adicionar helper no componente de visitantes**

Em `visitantes-page.component.ts`, adicionar como método da classe:

```ts
/** "YYYY-MM-DDTHH:mm" em hora local, somando `horas` à data atual. */
private localDateTime(horas = 0): string {
  const d = new Date(Date.now() + horas * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
```

- [ ] **Step 2: Adicionar o mesmo helper no componente do dashboard**

Idêntico, em `dashboard-page.component.ts` (cada componente é standalone; DRY aqui significa um helper por componente, sem criar um util compartilhado para tão pouco — YAGNI).

```ts
private localDateTime(horas = 0): string {
  const d = new Date(Date.now() + horas * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
```

- [ ] **Step 3: Compilar**

Run: `cd click-cond-web && npx nx build portaria-web --skip-nx-cache`
Expected: SUCCESS (helpers ainda não usados — sem erro de "unused" no Angular).

- [ ] **Step 4: Commit**

```bash
git add click-cond-web/apps/portaria-web/src/app/visitantes/visitantes-page.component.ts click-cond-web/apps/portaria-web/src/app/dashboard/dashboard-page.component.ts
git commit -m "chore(visitantes): helper de data/hora local para campos de validade"
```

---

### Task 2: Campos de validade no formulário "Nova Visita" (visitantes)

**Files:**
- Modify: `click-cond-web/apps/portaria-web/src/app/visitantes/visitantes-page.component.ts`
- Modify: `click-cond-web/apps/portaria-web/src/app/visitantes/visitantes-page.component.html`

O texto do form já diz "informe apenas o apartamento e a validade", mas não há inputs. `salvar()` já envia `this.novo.data_hora_inicio/termino` no ramo `novaVisitaPara` — basta popular e renderizar.

- [ ] **Step 1: Default da janela ao abrir "Nova Visita"**

Em `visitantes-page.component.ts`, achar o método que abre a Nova Visita (seta `novaVisitaPara`). Logo após setar `this.novo` para o estado inicial, definir o default:

```ts
this.novo.data_hora_inicio = this.localDateTime(0);     // agora
this.novo.data_hora_termino = this.localDateTime(4);    // +4h
```

(Se houver mais de um ponto que entra no modo Nova Visita, aplicar nos dois.)

- [ ] **Step 2: Inputs no HTML (modo Nova Visita e nova entrada)**

Em `visitantes-page.component.html`, logo após o bloco do "Apartamento de destino" (label que contém `>Apartamento de destino *<`), adicionar dentro do mesmo `grid`:

```html
<label class="block">
  <span class="text-xs font-medium text-slate-400 mb-1.5 block">Liberado a partir de</span>
  <input type="datetime-local" [(ngModel)]="novo.data_hora_inicio"
    class="w-full px-3 py-2.5 text-sm rounded-lg bg-graphite border border-white/10 text-white focus:outline-none focus:border-accent/60" />
</label>
<label class="block">
  <span class="text-xs font-medium text-slate-400 mb-1.5 block">Liberado até</span>
  <input type="datetime-local" [(ngModel)]="novo.data_hora_termino"
    class="w-full px-3 py-2.5 text-sm rounded-lg bg-graphite border border-white/10 text-white focus:outline-none focus:border-accent/60" />
  <span class="text-[10px] text-slate-500 mt-1 block">Deixe em branco para acesso sem prazo. Após o término, o aparelho nega sozinho.</span>
</label>
```

- [ ] **Step 3: Garantir o envio no fluxo de NOVA ENTRADA (create)**

`salvar()` no ramo `novaVisitaPara` já envia as datas. No ramo de **cadastro novo** (create de visitante), confirmar que `this.novo.data_hora_inicio/termino` vão no payload do `create`. Se o create monta o payload explicitamente, incluir:

```ts
data_hora_inicio: this.novo.data_hora_inicio,
data_hora_termino: this.novo.data_hora_termino,
```

- [ ] **Step 4: Compilar**

Run: `cd click-cond-web && npx nx build portaria-web --skip-nx-cache`
Expected: SUCCESS.

- [ ] **Step 5: Commit**

```bash
git add click-cond-web/apps/portaria-web/src/app/visitantes/
git commit -m "feat(visitantes): janela de validade (início/término) na Nova Visita"
```

---

### Task 3: Campos de validade no modal "Liberar Visitante" (dashboard)

**Files:**
- Modify: `click-cond-web/apps/portaria-web/src/app/dashboard/dashboard-page.component.ts`
- Modify: `click-cond-web/apps/portaria-web/src/app/dashboard/dashboard-page.component.html`

`confirmarLiberacao()` hoje só envia `{ id_apartamento }`. Adicionar a janela.

- [ ] **Step 1: Signals da janela + default ao abrir o modal**

Em `dashboard-page.component.ts`, junto aos signals do modal de liberação:

```ts
readonly liberarInicio = signal<string>('');
readonly liberarTermino = signal<string>('');
```

Em `abrirModalLiberar()`, após resetar o estado:

```ts
this.liberarInicio.set(this.localDateTime(0));
this.liberarTermino.set(this.localDateTime(4));
```

- [ ] **Step 2: Enviar a janela em confirmarLiberacao()**

Substituir o corpo do `novaVisitaPessoa`:

```ts
this.visitantesService.novaVisitaPessoa(p.id, {
  id_apartamento: idApto,
  data_hora_inicio: this.liberarInicio() || undefined,
  data_hora_termino: this.liberarTermino() || undefined,
}).subscribe({
```

- [ ] **Step 3: Inputs no HTML do modal**

Em `dashboard-page.component.html`, logo após o bloco do `<select [(ngModel)]="idApartamentoSelecionado">` (o "APARTAMENTO DE DESTINO") e antes do parágrafo "Ação de Liberação Rápida", adicionar:

```html
<div class="grid grid-cols-2 gap-3 mt-4">
  <label class="block">
    <span class="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5 block">Liberado a partir de</span>
    <input type="datetime-local" [(ngModel)]="liberarInicio"
      class="w-full px-3 py-2.5 text-sm rounded-lg bg-graphite border border-white/10 text-white focus:outline-none focus:border-accent/60" />
  </label>
  <label class="block">
    <span class="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5 block">Liberado até</span>
    <input type="datetime-local" [(ngModel)]="liberarTermino"
      class="w-full px-3 py-2.5 text-sm rounded-lg bg-graphite border border-white/10 text-white focus:outline-none focus:border-accent/60" />
  </label>
</div>
```

- [ ] **Step 4: Compilar**

Run: `cd click-cond-web && npx nx build portaria-web --skip-nx-cache`
Expected: SUCCESS.

- [ ] **Step 5: Commit**

```bash
git add click-cond-web/apps/portaria-web/src/app/dashboard/
git commit -m "feat(dashboard): janela de validade (início/término) na liberação de visitante"
```

---

### Task 4: Verificação manual ponta a ponta

**Files:** nenhum (teste manual — não há harness de teste de componente no projeto para essas telas).

- [ ] **Step 1: Build geral + push**

Run: `cd click-cond-web && npx nx build portaria-web --skip-nx-cache && cd .. && git push origin HEAD:master && git push origin main`
Expected: build OK, push OK (Vercel rebuild).

- [ ] **Step 2: Testar Nova Visita**

Após deploy + Ctrl+Shift+R: Visitantes → "Nova Visita" numa pessoa → os campos "Liberado a partir de / até" aparecem com default (agora / +4h) → confirmar → abrir o detalhe da visita e ver "Período de Acesso" com a janela.

- [ ] **Step 3: Testar Liberar (dashboard)**

Dashboard → "Liberar Visitante" → selecionar pessoa + apartamento + ajustar janela → Confirmar → a visita nasce liberada com a janela; o rosto sobe ao aparelho com ValidFrom/ValidTo = janela (nega após o término).

---

## Notas

- **Sem mudança de backend:** `novaVisitaParaPessoa`/`create` já persistem `data_hora_inicio`/`data_hora_termino`; a checagem de expiração no `runWebhook` e o `ValidFrom/ValidTo` no aparelho já consomem esses campos (commit 70c6c52).
- **Formato:** `datetime-local` entrega `YYYY-MM-DDTHH:mm` (hora local); `new Date(...)` no backend interpreta como local — consistente com a checagem de validade existente.
- **Tipo da pessoa (visitante/prestador):** já é herdado da pessoa selecionada (ref.is_visitante/is_prestador) — não precisa de campo novo; o card da pessoa já mostra quem é.
