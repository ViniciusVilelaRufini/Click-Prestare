# Landing /sobre — simulador como pedido de orçamento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o simulador da landing `/sobre` coletar nome, condomínio e WhatsApp junto do preço, levar os CTAs ao simulador e ajustar textos/oferta, para subir a taxa de lead completo de ~0,6% para ≥ 5%.

**Architecture:** Tudo acontece em um único HTML estático (`apps/portaria-web/public/sobre/index.html`). A lógica nova e testável (validação + registro do lead + abertura do WhatsApp, e a mensagem do simulador) entra no `<script>` do `<head>` como funções `window.ps*`, ao lado do `psRegistrarLead` que já existe; a classe `Component extends DCLogic` só monta os dados e chama essas funções. Os testes Jest extraem esses scripts do HTML e rodam em jsdom, no padrão de `marketing-conversao-openai.spec.ts`.

**Tech Stack:** HTML + framework de template "DC" da página (`{{ }}`, `<sc-if>`, `<x-import>`), JavaScript ES2017 sem build, Jest (jest-preset-angular, jsdom) via Nx.

**Spec:** `docs/superpowers/specs/2026-10-04-landing-conversao-simulador-design.md`

## Global Constraints

- Arquivo alvo único: `click-cond-web/apps/portaria-web/public/sobre/index.html`. Sem mudança no backend, no banco ou em variável de ambiente.
- Oferta (texto fixo, sem contador): "implantação grátis para os 10 primeiros condomínios". Implantação cheia: R$ 490.
- Não usar depoimento, logo de cliente, número de uso, "sem fidelidade" nem "período de teste".
- Posicionamento: "funciona junto com o seu porteiro"; nunca "substitua o porteiro".
- WhatsApp válido = 10 a 13 dígitos depois de tirar a máscara (mesma regra de `validarLead` em `apps/api/src/app/marketing/lead-origem.ts`).
- `unidades` do lead ≤ 60 caracteres; `pagina` = `/sobre/#simulador` ou `/sobre/#contato`.
- Nenhuma conversão paga no navegador: nunca chamar `gtag('event','conversion')` nem `oaiq('measure','lead_created')`.
- O `required` do HTML não sobrevive ao framework da página: validação sempre manual (`setCustomValidity` + `reportValidity`).
- Os handlers extraídos pelos testes (`enviar`, `enviarSimulador`) precisam continuar no formato `  nome = (e) => {` … `\n  };` (2 espaços), e `enviar` precisa continuar sendo o último método antes de `  renderVals()`.
- Helpers de teste ficam dentro do próprio `*.spec.ts`: `tsconfig.app.json` compila todo `src/**/*.ts` que não seja spec, com `types: []`, então um helper separado usando `node:fs` quebraria o build do app.
- Todos os comandos rodam a partir de `click-cond-web/`. Testes: `npx jest -c apps/portaria-web/jest.config.cts <arquivo>`.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Branch: `feat/landing-conversao-simulador` (já criado, com o spec commitado).

---

### Task 1: Funções compartilhadas de pedido no `<head>`

**Files:**
- Modify: `apps/portaria-web/public/sobre/index.html:53-66` (script do `<head>` com `psRegistrarLead`)
- Create: `apps/portaria-web/src/app/landing-pedido-orcamento.spec.ts`

**Interfaces:**
- Produces:
  - `window.psRegistrarLead(dados)` — agora respeita `dados.pagina`; usa `location.pathname` só quando `dados.pagina` vier vazio.
  - `window.psEnviarPedido(p: { form: HTMLFormElement; obrigatorios: string[]; lead: object; mensagem: string; numero: string }): boolean` — valida os campos (`obrigatorios` não vazios; `contato` com 10–13 dígitos quando preenchido). Inválido → marca os campos, foca o primeiro, devolve `false` e não grava nem abre nada. Válido → `psRegistrarLead(p.lead)`, `window.open('https://wa.me/' + p.numero + '?text=' + encodeURIComponent(p.mensagem), '_blank', 'noopener')` e devolve `true`.
  - `window.psMensagemSimulador(d: { nome: string; condominio: string; whatsapp: string; resumo: string }): string` — texto do WhatsApp do simulador.

- [ ] **Step 1: Escrever os testes que falham**

Criar `apps/portaria-web/src/app/landing-pedido-orcamento.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Helpers locais de propósito: tsconfig.app.json compila todo src/**/*.ts que
// não é spec, e um arquivo de helper com node:fs quebraria o build do app.
function htmlDaLanding(): string {
  return readFileSync(join(process.cwd(), 'apps/portaria-web/public/sobre/index.html'), 'utf8');
}

function carregarRastreadorDaLanding(): void {
  const script = Array.from(htmlDaLanding().matchAll(/<script>([\s\S]*?)<\/script>/g))
    .map((m) => m[1])
    .find((conteudo) => conteudo.includes('window.psRegistrarLead'));
  if (!script) throw new Error('Rastreador de marketing da landing não encontrado.');
  new Function(script)();
}

function montarForm(campos: Record<string, string>): HTMLFormElement {
  document.body.innerHTML = `<form>${Object.entries(campos)
    .map(([nome, valor]) => `<input name="${nome}" value="${valor}" />`)
    .join('')}</form>`;
  return document.querySelector('form')!;
}

function prepararJanela() {
  const gtag = jest.fn();
  const oaiq = jest.fn();
  const fetch = jest.fn(() => Promise.resolve(new Response()));
  const open = jest.fn();
  Object.assign(window, { gtag, oaiq, fetch, open });
  return { gtag, oaiq, fetch, open };
}

function corpoEnviado(fetch: jest.Mock): Record<string, string> {
  return JSON.parse((fetch.mock.calls[0] as any[])[1].body);
}

describe('psRegistrarLead', () => {
  beforeEach(() => sessionStorage.clear());

  it('respeita a página informada pelo formulário', () => {
    const { fetch } = prepararJanela();
    carregarRastreadorDaLanding();
    (window as any).psRegistrarLead({ nome: 'Ana', pagina: '/sobre/#simulador' });
    expect(corpoEnviado(fetch).pagina).toBe('/sobre/#simulador');
  });

  it('usa o caminho da página quando o formulário não informa', () => {
    const { fetch } = prepararJanela();
    carregarRastreadorDaLanding();
    (window as any).psRegistrarLead({ nome: 'Ana' });
    expect(corpoEnviado(fetch).pagina).toBe(location.pathname);
  });
});

describe('psEnviarPedido', () => {
  beforeEach(() => sessionStorage.clear());

  const pedido = (form: HTMLFormElement) => ({
    form,
    obrigatorios: ['nome', 'condominio', 'contato'],
    lead: { nome: 'Ana', condominio: 'Azul', whatsapp: '(17) 99660-8148', unidades: '80 unidades', pagina: '/sobre/#simulador' },
    mensagem: 'Olá!',
    numero: '5517996608148',
  });

  it('grava o lead e abre o WhatsApp quando tudo é válido', () => {
    const { fetch, open, gtag, oaiq } = prepararJanela();
    carregarRastreadorDaLanding();
    const form = montarForm({ nome: 'Ana', condominio: 'Azul', contato: '(17) 99660-8148' });

    const ok = (window as any).psEnviarPedido(pedido(form));

    expect(ok).toBe(true);
    expect(corpoEnviado(fetch)).toMatchObject({ nome: 'Ana', whatsapp: '(17) 99660-8148', pagina: '/sobre/#simulador' });
    expect(open).toHaveBeenCalledWith('https://wa.me/5517996608148?text=Ol%C3%A1!', '_blank', 'noopener');
    expect(gtag).not.toHaveBeenCalledWith('event', 'conversion', expect.anything());
    expect(oaiq).not.toHaveBeenCalledWith('measure', 'lead_created', expect.anything());
  });

  it('não grava nem abre nada com campo obrigatório vazio', () => {
    const { fetch, open } = prepararJanela();
    carregarRastreadorDaLanding();
    const form = montarForm({ nome: 'Ana', condominio: '', contato: '(17) 99660-8148' });

    const ok = (window as any).psEnviarPedido(pedido(form));

    expect(ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect((form.elements.namedItem('condominio') as HTMLInputElement).validationMessage).toBe('Preencha este campo.');
  });

  it('recusa WhatsApp com menos de 10 dígitos', () => {
    const { fetch, open } = prepararJanela();
    carregarRastreadorDaLanding();
    const form = montarForm({ nome: 'Ana', condominio: 'Azul', contato: '99660-8148' });

    const ok = (window as any).psEnviarPedido(pedido(form));

    expect(ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect((form.elements.namedItem('contato') as HTMLInputElement).validationMessage).toBe('Informe o WhatsApp com DDD.');
  });
});

describe('psMensagemSimulador', () => {
  it('leva os dados, a simulação e a condição de lançamento', () => {
    prepararJanela();
    carregarRastreadorDaLanding();
    const msg: string = (window as any).psMensagemSimulador({
      nome: 'Ana Souza', condominio: 'Residencial Azul', whatsapp: '(17) 99660-8148', resumo: '80 unidades · Plus · R$ 773,00/mês',
    });
    expect(msg).toContain('*Nome:* Ana Souza');
    expect(msg).toContain('*Condomínio:* Residencial Azul');
    expect(msg).toContain('*WhatsApp:* (17) 99660-8148');
    expect(msg).toContain('*Simulação:* 80 unidades · Plus · R$ 773,00/mês');
    expect(msg).toContain('implantação grátis (10 primeiros condomínios)');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest -c apps/portaria-web/jest.config.cts apps/portaria-web/src/app/landing-pedido-orcamento.spec.ts`
Expected: FAIL — `pagina` volta `/` no primeiro teste e `psEnviarPedido`/`psMensagemSimulador` "is not a function".

- [ ] **Step 3: Implementar no `<head>`**

Em `index.html`, no `window.psRegistrarLead`, trocar a linha do `body`:

```js
        body: JSON.stringify(Object.assign({}, dados, origem, { pagina: location.pathname })),
```

por:

```js
        // O formulário diz de onde veio (#simulador ou #contato); clique solto usa o caminho.
        body: JSON.stringify(Object.assign({}, dados, origem, { pagina: (dados && dados.pagina) || location.pathname })),
```

Logo depois do fechamento `};` do `window.psRegistrarLead` (antes do `document.addEventListener('click', ...)`), inserir:

```js
  // Validação + registro + WhatsApp compartilhados pelos dois formulários
  // (simulador e #contato). O "required" do HTML não sobrevive ao render da
  // página, então a checagem é manual. Devolve false sem gravar nada quando
  // falta campo; a regra do WhatsApp é a mesma do backend (10 a 13 dígitos).
  window.psEnviarPedido = function (p) {
    var form = p.form;
    var f = new FormData(form);
    var invalidos = [];
    p.obrigatorios.forEach(function (campo) {
      if (!String(f.get(campo) || '').trim()) invalidos.push({ campo: campo, msg: 'Preencha este campo.' });
    });
    var contato = String(f.get('contato') || '').trim();
    var digitos = contato.replace(/\D/g, '');
    if (contato && (digitos.length < 10 || digitos.length > 13)) {
      invalidos.push({ campo: 'contato', msg: 'Informe o WhatsApp com DDD.' });
    }
    if (invalidos.length) {
      // A mensagem só some quando a pessoa corrige o campo: limpar no mesmo
      // tick do reportValidity fecharia a bolha antes de dar para ler.
      invalidos.forEach(function (i) {
        var el = form.elements.namedItem(i.campo);
        if (!el) return;
        el.setCustomValidity(i.msg);
        el.addEventListener('input', function () { el.setCustomValidity(''); }, { once: true });
      });
      if (typeof form.reportValidity === 'function') form.reportValidity();
      var primeiro = form.elements.namedItem(invalidos[0].campo);
      if (primeiro && typeof primeiro.focus === 'function') primeiro.focus();
      return false;
    }
    if (window.psRegistrarLead) window.psRegistrarLead(p.lead);
    window.open('https://wa.me/' + p.numero + '?text=' + encodeURIComponent(p.mensagem), '_blank', 'noopener');
    return true;
  };
  // Mensagem do pedido feito pelo simulador. A linha da oferta registra que a
  // condição de lançamento valia quando o lead pediu.
  window.psMensagemSimulador = function (d) {
    return [
      '*Proposta pelo simulador — Prestare Gestão*',
      '',
      'Olá! Simulei no site e quero a proposta para o meu condomínio.',
      '',
      '*Nome:* ' + d.nome,
      '*Condomínio:* ' + d.condominio,
      '*WhatsApp:* ' + d.whatsapp,
      '*Simulação:* ' + d.resumo,
      '',
      'Condição de lançamento: implantação grátis (10 primeiros condomínios).',
      '',
      '_Enviado pelo site prestarecondominios.com.br/sobre_'
    ].join('\n');
  };
```

- [ ] **Step 4: Rodar e ver passar (novos e antigos)**

Run: `npx jest -c apps/portaria-web/jest.config.cts apps/portaria-web/src/app/landing-pedido-orcamento.spec.ts apps/portaria-web/src/app/marketing-conversao-openai.spec.ts`
Expected: PASS em todos (7 novos + 2 antigos).

- [ ] **Step 5: Commit**

```bash
git add apps/portaria-web/public/sobre/index.html apps/portaria-web/src/app/landing-pedido-orcamento.spec.ts
git commit -m "feat(landing): envio de pedido compartilhado e mensagem do simulador

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Formulário `#contato` passa a usar `psEnviarPedido`

**Files:**
- Modify: `apps/portaria-web/public/sobre/index.html` — método `enviar` da classe (hoje ~linhas 1624-1684)
- Modify: `apps/portaria-web/src/app/landing-pedido-orcamento.spec.ts`

**Interfaces:**
- Consumes: `window.psEnviarPedido` (Task 1).
- Produces: `enviar` envia o lead com `pagina: '/sobre/#contato'`; continua sendo o último método antes de `renderVals()`.

- [ ] **Step 1: Escrever os testes que falham**

No `landing-pedido-orcamento.spec.ts`, adicionar o helper logo depois de `corpoEnviado`:

```ts
/** Extrai `  nome = (e) => { ... };` da classe do componente como função comum. */
function carregarHandler(nome: string): (this: any, event: any) => void {
  const html = htmlDaLanding();
  const inicio = html.indexOf(`  ${nome} = (e) => {`);
  const fim = html.indexOf('\n  };', inicio);
  if (inicio < 0 || fim < 0) throw new Error(`Handler ${nome} da landing não encontrado.`);
  const corpo = html.slice(inicio, fim + 5).replace(`${nome} = (e) =>`, `return function ${nome}(e)`);
  return new Function(corpo)();
}
```

E no fim do arquivo:

```ts
describe('formulário #contato', () => {
  beforeEach(() => sessionStorage.clear());

  const contexto = () => ({
    _enviando: false,
    state: { enviado: false },
    props: { whatsapp: '5517996608148' },
    tituloCaso: (v: string) => v,
    formatarTelefone: (v: string) => v,
    setState: jest.fn(),
  });

  it('grava o lead marcado como #contato e abre o WhatsApp', () => {
    const { fetch, open } = prepararJanela();
    carregarRastreadorDaLanding();
    const form = montarForm({ nome: 'Ana', contato: '(17) 99660-8148', condominio: 'Azul', unidades: '24', site: '' });
    const ctx = contexto();

    carregarHandler('enviar').call(ctx, { preventDefault: jest.fn(), target: form });

    expect(corpoEnviado(fetch)).toMatchObject({ nome: 'Ana', unidades: '24', pagina: '/sobre/#contato' });
    expect(open).toHaveBeenCalledWith(expect.stringContaining('https://wa.me/5517996608148?text='), '_blank', 'noopener');
    expect(ctx.setState).toHaveBeenCalledWith({ enviado: true });
  });

  it('não envia com WhatsApp curto', () => {
    const { fetch, open } = prepararJanela();
    carregarRastreadorDaLanding();
    const form = montarForm({ nome: 'Ana', contato: '9966', condominio: 'Azul', unidades: '24', site: '' });
    const ctx = contexto();

    carregarHandler('enviar').call(ctx, { preventDefault: jest.fn(), target: form });

    expect(fetch).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(ctx.setState).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest -c apps/portaria-web/jest.config.cts apps/portaria-web/src/app/landing-pedido-orcamento.spec.ts -t "formulário #contato"`
Expected: FAIL — `pagina` vem `/` em vez de `/sobre/#contato` e o WhatsApp curto ainda abre.

- [ ] **Step 3: Reescrever `enviar`**

Substituir o método `enviar` inteiro (de `  enviar = (e) => {` até o `  };` que o fecha, imediatamente antes de `  renderVals() {`) por:

```js
  enviar = (e) => {
    e.preventDefault();
    // Guarda contra duplo envio: dois cliques rapidos no botao (antes do
    // form sumir da tela, ja que o setState de "enviado" nao e sincrono)
    // nao podem abrir o WhatsApp duas vezes nem registrar dois leads.
    if (this.state.enviado || this._enviando) return;
    const form = e.target;
    const f = new FormData(form);
    const unidadesBruto = String(f.get("unidades") ?? "").trim();

    // Linha em branco entre os blocos e rótulo em negrito (*x* é a marcação do
    // WhatsApp): sem isso a mensagem chega como um parágrafo corrido.
    const linhas = [
      "*Pedido de orçamento — Prestare Gestão*",
      "",
      "Olá! Gostaria de receber um orçamento do Prestare Gestão para o meu condomínio.",
      "",
      "*Nome:* " + this.tituloCaso(f.get("nome")),
      "*Condomínio:* " + this.tituloCaso(f.get("condominio")),
      "*WhatsApp:* " + this.formatarTelefone(f.get("contato")),
      "*Unidades:* " + unidadesBruto,
      "",
      "_Enviado pelo site prestarecondominios.com.br/sobre_"
    ];

    const num = (this.props.whatsapp ?? "5517996608148").replace(/\D/g, "");
    // Validação, registro do lead e WhatsApp ficam em psEnviarPedido (no
    // <head>), compartilhado com o formulário do simulador.
    const ok = window.psEnviarPedido({
      form: form,
      obrigatorios: ["nome", "contato", "condominio", "unidades"],
      lead: {
        nome: String(f.get("nome") || ""),
        condominio: String(f.get("condominio") || ""),
        unidades: unidadesBruto,
        whatsapp: String(f.get("contato") || ""),
        site: String(f.get("site") || ""),
        pagina: "/sobre/#contato"
      },
      mensagem: linhas.join("\n"),
      numero: num
    });
    if (!ok) return;
    this._enviando = true;
    this.setState({ enviado: true });
  };
```

- [ ] **Step 4: Rodar e ver passar (novos e antigos)**

Run: `npx jest -c apps/portaria-web/jest.config.cts apps/portaria-web/src/app/landing-pedido-orcamento.spec.ts apps/portaria-web/src/app/marketing-conversao-openai.spec.ts`
Expected: PASS em todos. O teste antigo "does not call paid conversions when a valid form is submitted" continua passando: ele chama `carregarRastreadorDaLanding()` antes, então `psEnviarPedido` existe.

- [ ] **Step 5: Commit**

```bash
git add apps/portaria-web/public/sobre/index.html apps/portaria-web/src/app/landing-pedido-orcamento.spec.ts
git commit -m "refactor(landing): formulario de contato usa o envio compartilhado

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Pedido de orçamento dentro do simulador

**Files:**
- Modify: `apps/portaria-web/public/sobre/index.html` — `<style>` (selo), card de resultado do `#simulador` (~linhas 849-856), `state` (~1247-1256), novo método `enviarSimulador` (antes de `enviar`), `simVals` (~1600-1622), `renderVals` (~1686)
- Modify: `apps/portaria-web/src/app/landing-pedido-orcamento.spec.ts`

**Interfaces:**
- Consumes: `window.psEnviarPedido`, `window.psMensagemSimulador` (Task 1); métodos existentes `calcularPlano(n) → { plano, incluso, mensal }`, `brl(v) → string`, `tituloCaso(v)`, `formatarTelefone(v)`.
- Produces: estado `simEnviado: boolean`; método `enviarSimulador(e)`; valores de template `simForm`, `simConfirmado`, `enviarSimulador`.

- [ ] **Step 1: Escrever os testes que falham**

No fim de `landing-pedido-orcamento.spec.ts`:

```ts
describe('formulário do simulador', () => {
  beforeEach(() => sessionStorage.clear());

  const contexto = () => ({
    _enviandoSim: false,
    state: { simEnviado: false, simUnidades: 80 },
    props: { whatsapp: '5517996608148' },
    tituloCaso: (v: string) => v,
    formatarTelefone: (v: string) => v,
    calcularPlano: () => ({ plano: 'Plus', incluso: '', mensal: 773 }),
    brl: (v: number) => 'R$ ' + v.toFixed(2).replace('.', ','),
    setState: jest.fn(),
  });

  it('grava o lead com a simulação e marca a origem #simulador', () => {
    const { fetch, open } = prepararJanela();
    carregarRastreadorDaLanding();
    const form = montarForm({ nome: 'Ana', condominio: 'Azul', contato: '(17) 99660-8148', site: '' });
    const ctx = contexto();

    carregarHandler('enviarSimulador').call(ctx, { preventDefault: jest.fn(), target: form });

    expect(corpoEnviado(fetch)).toMatchObject({
      nome: 'Ana',
      condominio: 'Azul',
      whatsapp: '(17) 99660-8148',
      unidades: '80 unidades · Plus · R$ 773,00/mês',
      pagina: '/sobre/#simulador',
    });
    const url = decodeURIComponent((open.mock.calls[0] as any[])[0]);
    expect(url).toContain('*Simulação:* 80 unidades · Plus · R$ 773,00/mês');
    expect(url).toContain('implantação grátis');
    expect(ctx.setState).toHaveBeenCalledWith({ simEnviado: true });
  });

  it('não envia sem o nome do condomínio', () => {
    const { fetch, open } = prepararJanela();
    carregarRastreadorDaLanding();
    const form = montarForm({ nome: 'Ana', condominio: '', contato: '(17) 99660-8148', site: '' });
    const ctx = contexto();

    carregarHandler('enviarSimulador').call(ctx, { preventDefault: jest.fn(), target: form });

    expect(fetch).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(ctx.setState).not.toHaveBeenCalled();
  });

  it('não envia duas vezes', () => {
    const { fetch } = prepararJanela();
    carregarRastreadorDaLanding();
    const form = montarForm({ nome: 'Ana', condominio: 'Azul', contato: '(17) 99660-8148', site: '' });
    const ctx = { ...contexto(), state: { simEnviado: true, simUnidades: 80 } };

    carregarHandler('enviarSimulador').call(ctx, { preventDefault: jest.fn(), target: form });

    expect(fetch).not.toHaveBeenCalled();
  });

  it('o card do simulador tem o formulário, o selo e o atalho do WhatsApp', () => {
    const html = htmlDaLanding();
    const inicio = html.indexOf('<section id="simulador"');
    const card = html.slice(inicio, html.indexOf('</section>', inicio));
    expect(card).toContain('onSubmit="{{ enviarSimulador }}"');
    expect(card).toContain('Receber minha proposta');
    expect(card).toContain('implantação grátis para os 10 primeiros condomínios');
    expect(card).toContain('Prefere falar direto? Abrir o WhatsApp');
    expect(card).toContain('Sem compromisso');
    expect(card).toContain('Proposta com o valor exato do seu condomínio');
    expect(card).toContain('Seus dados sob a LGPD, sem spam');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest -c apps/portaria-web/jest.config.cts apps/portaria-web/src/app/landing-pedido-orcamento.spec.ts -t "formulário do simulador"`
Expected: FAIL — "Handler enviarSimulador da landing não encontrado." e o card sem os textos.

- [ ] **Step 3: CSS do selo**

No `<style>`, logo antes de `  /* ─── Barra fixa de CTA (so no celular) ───`, inserir:

```css
  /* Selo da condição de lançamento no resultado do simulador. */
  .ps-selo-oferta { display: inline-flex; align-items: center; gap: 6px; margin-top: 12px; padding: 6px 12px; border-radius: var(--radius-pill); background: #fff7e6; border: 1px solid #f5c26b; color: #8a4b00; font: var(--type-caption); font-weight: 600; }
```

- [ ] **Step 4: Template do card de resultado**

Substituir o bloco atual:

```html
          <p style="margin: 6px 0 0; font: var(--type-sub); color: var(--text-body);">Equivale a <strong>{{ simPorUnidade }}</strong> por unidade · implantação única de {{ simImplantacao }}</p>
          <a href="{{ simLink }}" data-sim="{{ simResumo }}" target="_blank" rel="noopener" style="display: inline-flex; align-items: center; justify-content: center; margin-top: 22px; padding: 14px 22px; border-radius: var(--radius-md); background: var(--prestare-blue-600); color: #fff; font: var(--type-body-strong); text-decoration: none; transition: background 150ms ease, transform 150ms ease;" style-hover="background: var(--prestare-blue-700); color: #fff; transform: translateY(-1px);">Quero essa proposta pelo WhatsApp</a>
        </sc-if>
```

por:

```html
          <p style="margin: 6px 0 0; font: var(--type-sub); color: var(--text-body);">Equivale a <strong>{{ simPorUnidade }}</strong> por unidade · implantação <s style="color: var(--text-faint);">{{ simImplantacao }}</s> <strong style="color: #15803d;">grátis</strong></p>
          <span class="ps-selo-oferta">Condição de lançamento: implantação grátis para os 10 primeiros condomínios</span>

          <!-- O pedido nasce aqui, no momento em que a pessoa acabou de ver o
               preço: as unidades já vêm do simulador, só faltam três campos. -->
          <sc-if value="{{ simForm }}" hint-placeholder-val="{{ true }}">
            <form id="ps-form-simulador" onSubmit="{{ enviarSimulador }}" style="position: relative; display: grid; gap: 10px; margin-top: 20px; padding-top: 18px; border-top: 1px solid var(--prestare-blue-200);">
              <span style="font: var(--type-body-strong); color: var(--text-strong);">Receba esta proposta no seu WhatsApp</span>
              <div class="ps-field-row">
                <input name="nome" autocomplete="name" placeholder="Seu nome" aria-label="Seu nome">
                <input name="condominio" placeholder="Nome do condomínio" aria-label="Nome do condomínio">
              </div>
              <input name="contato" inputmode="tel" autocomplete="tel" placeholder="WhatsApp (00) 00000-0000" aria-label="Seu WhatsApp com DDD">
              <!-- Honeypot anti-spam: invisível para gente, bots preenchem tudo. -->
              <input name="site" tabindex="-1" autocomplete="off" aria-hidden="true" style="position: absolute; left: -9999px; width: 1px; height: 1px; opacity: 0;">
              <x-import component-from-global-scope="PrestareDesignSystem_ea5733.Button" type="submit" size="lg" full-width="{{ true }}" icon-right="arrow-right" hint-size="100%,52px">Receber minha proposta</x-import>
              <div style="display: flex; flex-wrap: wrap; gap: 6px 14px;">
                <span style="display: inline-flex; align-items: center; gap: 6px; font: var(--type-caption); color: var(--text-muted);">
                  <x-import component-from-global-scope="PrestareDesignSystem_ea5733.Icon" name="check" size="14" color="var(--prestare-blue-500)" hint-size="14px,14px"></x-import>
                  Sem compromisso
                </span>
                <span style="display: inline-flex; align-items: center; gap: 6px; font: var(--type-caption); color: var(--text-muted);">
                  <x-import component-from-global-scope="PrestareDesignSystem_ea5733.Icon" name="check" size="14" color="var(--prestare-blue-500)" hint-size="14px,14px"></x-import>
                  Proposta com o valor exato do seu condomínio
                </span>
                <span style="display: inline-flex; align-items: center; gap: 6px; font: var(--type-caption); color: var(--text-muted);">
                  <x-import component-from-global-scope="PrestareDesignSystem_ea5733.Icon" name="shield-check" size="14" color="var(--prestare-blue-500)" hint-size="14px,14px"></x-import>
                  Seus dados sob a LGPD, sem spam
                </span>
              </div>
              <a href="{{ simLink }}" data-sim="{{ simResumo }}" target="_blank" rel="noopener" style="justify-self: start; font: var(--type-sub); color: var(--prestare-blue-700); text-decoration: underline; text-underline-offset: 3px;">Prefere falar direto? Abrir o WhatsApp</a>
            </form>
          </sc-if>
          <sc-if value="{{ simConfirmado }}" hint-placeholder-val="{{ false }}">
            <div role="status" style="display: flex; flex-direction: column; align-items: flex-start; gap: 8px; margin-top: 20px; padding-top: 18px; border-top: 1px solid var(--prestare-blue-200);">
              <x-import component-from-global-scope="PrestareDesignSystem_ea5733.IconChip" icon="circle-check" tone="success" size="md" hint-size="40px,40px"></x-import>
              <strong style="font: var(--type-body-strong); color: var(--text-strong);">Proposta pedida</strong>
              <p style="margin: 0; font: var(--type-sub); color: var(--text-muted);">Abrimos o WhatsApp com os seus dados. Se a janela não abrir, chame em <strong style="font-weight: 600;">{{ telefone }}</strong>.</p>
            </div>
          </sc-if>
        </sc-if>
```

- [ ] **Step 5: Estado, método e valores de template**

No `state`, trocar `    simUnidades: 60` por:

```js
    simUnidades: 60, simEnviado: false
```

Inserir o método **imediatamente antes** de `  enviar = (e) => {` (precisa ficar antes: o teste antigo extrai `enviar` até o último `};` antes de `renderVals`):

```js
  // Pedido feito no card do simulador: as unidades vêm da simulação e o lead
  // chega ao CRM como "80 unidades · Plus · R$ 773,00/mês".
  enviarSimulador = (e) => {
    e.preventDefault();
    if (this.state.simEnviado || this._enviandoSim) return;
    const form = e.target;
    const f = new FormData(form);
    const n = Number(this.state.simUnidades);
    if (!Number.isFinite(n) || n < 1) return;
    const c = this.calcularPlano(n);
    const resumo = n + " unidades · " + c.plano + " · " + this.brl(c.mensal) + "/mês";
    const num = (this.props.whatsapp ?? "5517996608148").replace(/\D/g, "");
    const ok = window.psEnviarPedido({
      form: form,
      obrigatorios: ["nome", "condominio", "contato"],
      lead: {
        nome: String(f.get("nome") || ""),
        condominio: String(f.get("condominio") || ""),
        unidades: resumo,
        whatsapp: String(f.get("contato") || ""),
        site: String(f.get("site") || ""),
        pagina: "/sobre/#simulador"
      },
      mensagem: window.psMensagemSimulador({
        nome: this.tituloCaso(f.get("nome")),
        condominio: this.tituloCaso(f.get("condominio")),
        whatsapp: this.formatarTelefone(f.get("contato")),
        resumo: resumo
      }),
      numero: num
    });
    if (!ok) return;
    this._enviandoSim = true;
    this.setState({ simEnviado: true });
  };
```

Em `simVals`, logo depois de `      simSemValor: !ok,`, inserir:

```js
      simForm: ok && !this.state.simEnviado,
      simConfirmado: ok && this.state.simEnviado,
```

Em `renderVals`, logo depois de `      enviar: this.enviar,`, inserir:

```js
      enviarSimulador: this.enviarSimulador,
```

- [ ] **Step 6: Rodar e ver passar (novos e antigos)**

Run: `npx jest -c apps/portaria-web/jest.config.cts apps/portaria-web/src/app/landing-pedido-orcamento.spec.ts apps/portaria-web/src/app/marketing-conversao-openai.spec.ts apps/portaria-web/src/app/favicon-landing.spec.ts`
Expected: PASS em todos.

- [ ] **Step 7: Commit**

```bash
git add apps/portaria-web/public/sobre/index.html apps/portaria-web/src/app/landing-pedido-orcamento.spec.ts
git commit -m "feat(landing): pedido de orcamento dentro do simulador

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Topo, contexto do simulador e barra do celular levam ao preço

**Files:**
- Modify: `apps/portaria-web/public/sobre/index.html` — hero (~392-408), texto do `#simulador` (~840), `.ps-barra` CSS (~274-286) e HTML (~1096-1103), `state`, `componentDidMount`, `componentWillUnmount`, novo `irParaSimulador`/`observarBarra` (perto de `irParaContato`), `renderVals`
- Modify: `apps/portaria-web/src/app/landing-pedido-orcamento.spec.ts`

**Interfaces:**
- Produces: método `irParaSimulador(e)`; estado `barraOculta: boolean`; valores de template `irParaSimulador`, `barraTransform`, `barraEventos`.

- [ ] **Step 1: Escrever os testes que falham**

No fim de `landing-pedido-orcamento.spec.ts`:

```ts
describe('caminho até o preço', () => {
  const trecho = (html: string, inicioMarca: string, fimMarca: string) => {
    const inicio = html.indexOf(inicioMarca);
    return html.slice(inicio, html.indexOf(fimMarca, inicio));
  };

  it('o botão principal do topo leva ao simulador, não ao WhatsApp', () => {
    const hero = trecho(htmlDaLanding(), '<section class="ps-hero"', '</section>');
    expect(hero).not.toContain('linkWhatsapp');
    expect(hero).toContain('href="#simulador"');
    expect(hero).toContain('Ver o preço para o meu condomínio');
    expect(hero).toContain('A partir de R$ 298/mês');
  });

  it('o simulador explica o produto para quem chega do anúncio', () => {
    const sim = trecho(htmlDaLanding(), '<section id="simulador"', '</section>');
    expect(sim).toContain('Controle de acesso com reconhecimento facial');
  });

  it('a barra do celular leva ao simulador', () => {
    const barra = trecho(htmlDaLanding(), '<div class="ps-barra"', '</div>');
    expect(barra).toContain('href="#simulador"');
    expect(barra).toContain('Ver meu preço');
    expect(barra).toContain('{{ barraTransform }}');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest -c apps/portaria-web/jest.config.cts apps/portaria-web/src/app/landing-pedido-orcamento.spec.ts -t "caminho até o preço"`
Expected: FAIL nos 3 testes.

- [ ] **Step 3: Hero**

Logo depois do parágrafo que termina em `sem planilha e sem livro de papel.</p>`, inserir:

```html
        <p style="margin: 14px 0 0; font: var(--type-body-strong); color: var(--prestare-blue-700);">A partir de R$ 298/mês · implantação grátis para os 10 primeiros condomínios</p>
```

Substituir:

```html
          <a href="{{ linkWhatsapp }}" target="_blank" rel="noopener" class="ps-cta">
            <x-import component-from-global-scope="PrestareDesignSystem_ea5733.Button" size="lg" icon-right="arrow-right" hint-size="240px,52px">Quero um orçamento</x-import>
          </a>
```

por:

```html
          <a href="#simulador" onClick="{{ irParaSimulador }}" class="ps-cta">
            <x-import component-from-global-scope="PrestareDesignSystem_ea5733.Button" size="lg" icon-right="arrow-right" hint-size="300px,52px">Ver o preço para o meu condomínio</x-import>
          </a>
```

- [ ] **Step 4: Contexto no simulador**

Substituir:

```html
        <p class="ps-lead">Informe o número de unidades e veja na hora o plano indicado e a mensalidade. Sem cadastro.</p>
```

por:

```html
        <p class="ps-lead">Controle de acesso com reconhecimento facial, visitantes e encomendas no app do morador e console para a portaria. Informe o número de unidades e veja na hora o plano indicado e a mensalidade.</p>
```

(A frase "Funciona junto com o seu porteiro…" logo abaixo continua como está.)

- [ ] **Step 5: Barra do celular**

No CSS, dentro de `.ps-barra { ... }` do `@media (max-width: 720px)`, acrescentar a linha:

```css
      transition: transform 220ms cubic-bezier(.2,.8,.28,1);
```

Substituir o HTML da barra:

```html
  <div class="ps-barra">
    <a href="#contato" style="flex: 1 1 auto; min-width: 0;">
      <x-import component-from-global-scope="PrestareDesignSystem_ea5733.Button" size="md" icon-right="arrow-right" full-width="{{ true }}" hint-size="100%,46px">Quero um orçamento</x-import>
    </a>
```

por:

```html
  <div class="ps-barra" style="transform: {{ barraTransform }}; pointer-events: {{ barraEventos }};">
    <a href="#simulador" onClick="{{ irParaSimulador }}" style="flex: 1 1 auto; min-width: 0;">
      <x-import component-from-global-scope="PrestareDesignSystem_ea5733.Button" size="md" icon-right="arrow-right" full-width="{{ true }}" hint-size="100%,46px">Ver meu preço</x-import>
    </a>
```

E atualizar o comentário acima da barra para:

```html
  <!-- Barra fixa: no celular o CTA fica sempre ao alcance do polegar e leva
       ao preço. Ela sai da frente enquanto o simulador ou o formulário estão
       na tela, para não cobrir os campos (observarBarra). -->
```

- [ ] **Step 6: Lógica do componente**

No `state`, trocar `    simUnidades: 60, simEnviado: false` por:

```js
    simUnidades: 60, simEnviado: false, barraOculta: false
```

Logo depois do método `irParaContato` (o `  };` que o fecha), inserir:

```js
  irParaSimulador = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const el = document.getElementById("simulador");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // A barra fixa do celular sai da frente enquanto o simulador ou o
  // formulário estão na tela: ali ela só cobriria os campos.
  observarBarra() {
    if (typeof IntersectionObserver === "undefined") return;
    const visiveis = new Set();
    this._obsBarra = new IntersectionObserver((entradas) => {
      entradas.forEach((en) => {
        if (en.isIntersecting) visiveis.add(en.target.id);
        else visiveis.delete(en.target.id);
      });
      const oculta = visiveis.size > 0;
      if (oculta !== this.state.barraOculta) this.setState({ barraOculta: oculta });
    }, { threshold: 0.15 });
    ["simulador", "contato"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) this._obsBarra.observe(el);
    });
  }
```

Em `componentDidMount`, logo depois de `    this.iniciarRotacao();`, inserir:

```js
    this.observarBarra();
```

Em `componentWillUnmount`, logo depois de `    this.pararRotacao();`, inserir:

```js
    if (this._obsBarra) this._obsBarra.disconnect();
```

Em `renderVals`, logo depois de `      irParaContato: this.irParaContato,`, inserir:

```js
      irParaSimulador: this.irParaSimulador,
      barraTransform: this.state.barraOculta ? "translateY(110%)" : "none",
      barraEventos: this.state.barraOculta ? "none" : "auto",
```

- [ ] **Step 7: Rodar e ver passar (todos)**

Run: `npx jest -c apps/portaria-web/jest.config.cts apps/portaria-web/src/app/landing-pedido-orcamento.spec.ts apps/portaria-web/src/app/marketing-conversao-openai.spec.ts apps/portaria-web/src/app/favicon-landing.spec.ts`
Expected: PASS em todos.

- [ ] **Step 8: Commit**

```bash
git add apps/portaria-web/public/sobre/index.html apps/portaria-web/src/app/landing-pedido-orcamento.spec.ts
git commit -m "feat(landing): topo e barra do celular levam ao simulador

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Textos de resposta, oferta no contato e FAQ

**Files:**
- Modify: `apps/portaria-web/public/sobre/index.html` — lista e subtítulo do `#contato` (~869-886), rodapé do formulário (~976-987), FAQ (~823-830)
- Modify: `apps/portaria-web/src/app/landing-pedido-orcamento.spec.ts`

**Interfaces:** nenhuma (só conteúdo).

- [ ] **Step 1: Escrever os testes que falham**

No fim de `landing-pedido-orcamento.spec.ts`:

```ts
describe('textos de resposta e oferta', () => {
  it('não promete mais resposta em 1 dia útil', () => {
    const html = htmlDaLanding();
    expect(html).not.toContain('Resposta em até 1 dia útil');
    expect(html.split('Resposta na hora pelo WhatsApp').length - 1).toBe(2);
    expect(html).toContain('Atendimento humano em horário comercial');
  });

  it('o contato e o FAQ explicam a condição de lançamento', () => {
    const html = htmlDaLanding();
    expect(html).toContain('Condição de lançamento: implantação grátis para os 10 primeiros condomínios.');
    expect(html).toContain('Como funciona a implantação grátis?');
  });

  it('não usa promessas que a Prestare não oferece', () => {
    const html = htmlDaLanding().toLowerCase();
    expect(html).not.toContain('sem fidelidade');
    expect(html).not.toContain('período de teste');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest -c apps/portaria-web/jest.config.cts apps/portaria-web/src/app/landing-pedido-orcamento.spec.ts -t "textos de resposta e oferta"`
Expected: FAIL nos 2 primeiros testes (o terceiro já passa e serve de guarda).

- [ ] **Step 3: Textos do `#contato`**

Na lista da coluna azul, substituir:

```html
            Resposta em até 1 dia útil, pelo WhatsApp
```

por:

```html
            Resposta na hora pelo WhatsApp
```

No rodapé do formulário, substituir:

```html
                Resposta em até 1 dia útil
```

por:

```html
                Resposta na hora pelo WhatsApp
```

E substituir:

```html
                Atendimento comercial humano
```

por:

```html
                Atendimento humano em horário comercial
```

No subtítulo da coluna azul, substituir:

```html
        <p style="margin: 14px 0 0; font: var(--type-body); color: rgba(255,255,255,.85); max-width: 44ch;">O valor acompanha o tamanho do condomínio. Diga quantas unidades e eu respondo com o orçamento e os módulos que fazem sentido para vocês.</p>
```

por:

```html
        <p style="margin: 14px 0 0; font: var(--type-body); color: rgba(255,255,255,.85); max-width: 44ch;">O valor acompanha o tamanho do condomínio. Diga quantas unidades e eu respondo com o orçamento e os módulos que fazem sentido para vocês.</p>
        <p style="margin: 10px 0 0; font: var(--type-body-strong); color: #fff; max-width: 44ch;">Condição de lançamento: implantação grátis para os 10 primeiros condomínios.</p>
```

- [ ] **Step 4: Pergunta nova no FAQ**

Logo depois do `</details>` da pergunta "Se a internet cair, para tudo?" (antes do `</div>` que fecha a coluna de perguntas), inserir:

```html
          <details class="ps-faq-item" style="background: var(--surface-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg);">
            <summary>
              <span style="font: var(--type-body-strong); color: inherit;">Como funciona a implantação grátis?</span>
              <svg class="ps-faq-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </summary>
            <p class="ps-faq-answer" style="font: var(--type-body); color: var(--text-muted); max-width: 82ch;">É a condição de lançamento: vale para os 10 primeiros condomínios que fecharem contrato. A implantação, que custa R$ 490, fica isenta; a mensalidade segue a tabela do simulador.</p>
          </details>
```

- [ ] **Step 5: Rodar a suíte inteira do portaria-web**

Run: `npx jest -c apps/portaria-web/jest.config.cts`
Expected: PASS em todas as suítes (não só as da landing).

- [ ] **Step 6: Commit**

```bash
git add apps/portaria-web/public/sobre/index.html apps/portaria-web/src/app/landing-pedido-orcamento.spec.ts
git commit -m "feat(landing): resposta na hora e condicao de lancamento no contato e FAQ

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Conferência visual e publicação

**Files:** nenhum código novo (só correções que a conferência revelar, cada uma com o teste correspondente).

- [ ] **Step 1: Servir a pasta pública localmente**

Run (em background): `npx http-server apps/portaria-web/public -p 4321 -c-1`
Expected: `Available on: http://127.0.0.1:4321`. Em `localhost`, o `psRegistrarLead` aponta para `http://localhost:3000` e falha em silêncio — nenhum lead de teste chega ao CRM de produção.

- [ ] **Step 2: Conferir no computador (Playwright)**

Abrir `http://localhost:4321/sobre/?simular=1` e verificar:
- a página rola até o simulador; o texto de contexto aparece acima das unidades;
- com 80 unidades: "Plus", "R$ 773,00/mês", implantação "R$ 490,00" riscada + "grátis", selo da condição de lançamento, os 3 campos, o botão "Receber minha proposta", os 3 reforços e o link "Prefere falar direto?";
- apagar as unidades: some o card de valor e o formulário, aparece "Digite o número de unidades";
- enviar com o condomínio vazio: aparece a bolha "Preencha este campo." e nada abre;
- enviar preenchido: abre uma aba `wa.me` com a mensagem da simulação e o card mostra "Proposta pedida";
- `http://localhost:4321/sobre/`: o topo mostra "A partir de R$ 298/mês…" e o botão "Ver o preço para o meu condomínio" rola até o simulador; o formulário `#contato` e o FAQ novo aparecem.
- Console sem erro novo.

- [ ] **Step 3: Conferir no celular — pedir autorização antes**

Redimensionar a janela do navegador foi recusado antes nesta sessão. Perguntar ao usuário se pode redimensionar para 390×844; se não puder, registrar que a conferência de celular fica para ele fazer no próprio aparelho depois do deploy. Se autorizado, verificar: campos do simulador empilham sem rolagem horizontal; a barra "Ver meu preço" aparece no topo da página, some ao chegar no simulador e no contato, e volta depois; o botão de cookies não fica atrás da barra.

- [ ] **Step 4: Parar o servidor local**

Encerrar o processo do `http-server`.

- [ ] **Step 5: Pedir confirmação para publicar**

Publicar é ação externa (vai para produção). Mostrar ao usuário o resumo dos commits do branch e pedir o OK explícito antes do push.

- [ ] **Step 6: Merge e push (só com o OK)**

```bash
cd /c/Users/vinic/Desktop/Click-with-Prestare
git checkout master
git merge --no-ff feat/landing-conversao-simulador -m "Merge branch 'feat/landing-conversao-simulador'

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin master
git push origin master:main
```

Expected: os dois pushes aceitos. Se o workflow da API (`deploy-api.yml`) colidir pelos dois pushes, disparar de novo com `gh workflow run deploy-api.yml` (a landing não depende dele).

- [ ] **Step 7: Conferir em produção sem gerar lead**

Depois que o Amplify publicar, abrir `https://www.prestarecondominios.com.br/sobre/?simular=1` e repetir só a conferência visual do Step 2. **Não enviar o formulário em produção** — criaria lead real no CRM e abriria conversa no WhatsApp comercial.

- [ ] **Step 8: Registrar a base de medição**

Anotar no CRM ou numa memória a data da publicação, para comparar 3 semanas depois: taxa de lead completo (base ≈ 0,6%) e taxa de lead total (base 2,9%) sobre cliques pagos, separando `pagina` `/sobre/#simulador` × `/sobre/#contato`.
