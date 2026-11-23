# CRM — aba Impostos (Simples Nacional) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aba "Impostos" no CRM que calcula o Simples Nacional da Prestare a partir das faturas reais, com simulador por unidades e cartão na Visão geral.

**Architecture:** Duas funções puras (tabelas do Simples + apuração da receita a partir das faturas) testadas com Jest; o `CrmStore` junta faturas, MRR e a configuração (`Crm_Config`, chaves novas) num `computed`; um componente standalone novo exibe tudo. Nenhuma mudança na API nem no banco.

**Tech Stack:** Angular 21 standalone + signals, Tailwind (design "Verdant" do CRM), Jest via Nx (`apps/crm-web`).

**Spec:** `docs/superpowers/specs/2026-11-23-crm-impostos-design.md`

## Global Constraints

- Tabelas conferidas na LC 123/2006 (Planalto, redação LC 155/2016) em 23/11/2026 — usar exatamente:
  - Anexo III: até 180.000 → 6,00% / 0; até 360.000 → 11,20% / 9.360; até 720.000 → 13,50% / 17.640; até 1.800.000 → 16,00% / 35.640; até 3.600.000 → 21,00% / 125.640; até 4.800.000 → 33,00% / 648.000.
  - Partilha III (IRPJ, CSLL, Cofins, PIS, CPP, ISS): F1 4,00/3,50/12,82/2,78/43,40/33,50; F2 4,00/3,50/14,05/3,05/43,40/32,00; F3 e F4 4,00/3,50/13,64/2,96/43,40/32,50; F5 4,00/3,50/12,82/2,78/43,40/33,50; F6 35,00/15,00/16,03/3,47/30,50/0.
  - Anexo V: 15,50% / 0; 18,00% / 4.500; 19,50% / 9.900; 20,50% / 17.100; 23,00% / 62.100; 30,50% / 540.000 (mesmos limites de faixa).
  - Partilha V: F1 25,00/15,00/14,10/3,05/28,85/14,00; F2 23,00/15,00/14,10/3,05/27,85/17,00; F3 24,00/15,00/14,92/3,23/23,85/19,00; F4 21,00/15,00/15,74/3,41/23,85/21,00; F5 23,00/12,50/14,10/3,05/23,85/23,50; F6 35,00/15,50/16,44/3,56/29,50/0.
- Fator R: ≥ 28% → Anexo III.
- Preço do site (/precos/, 09/11/2026): R$ 298 fixos até 30 unidades; + R$ 9,90/un. de 31 a 60; + R$ 8,90/un. de 61 a 120; + R$ 11,90/un. acima de 120. Implantação R$ 490.
- Chaves no `Crm_Config`: `imposto_anexo` (`fator_r` | `III` | `V`, padrão `fator_r`), `imposto_folha_mensal` (número em reais), `imposto_inicio_atividade` (`MM/AAAA` ou vazio).
- Receita pelo valor emitido (competência), faturas canceladas fora (o store já as remove).
- Toda tela com o aviso: "Estimativa. Confirme os valores com o seu contador."
- Textos da interface em pt-BR.
- Sem mudanças em `apps/api` nem em `prisma/`.

## Review Focus

- Folha não informada com modo `fator_r` → cai no Anexo V (15,5%); a tela precisa dizer isso em destaque, não só mostrar 15,5%. (Task 3)
- Mês corrente sem faturas geradas ainda → DAS do mês estimado pelo MRR, marcado como estimado. (Task 3)
- `GET /crm/faturas` traz no máximo 500 faturas → com base grande a receita de 12 meses sai menor; avisar quando `faturas().length >= 500`. (Task 3)
- Configuração salva corrompida ou folha digitada negativa/vazia → usar padrões e tratar folha como 0. (Task 3)
- Receita de 12 meses acima de R$ 1,8 milhão (teto de ISS na 5ª faixa, sublimite e exclusão) → não calcular partilha fina; mostrar aviso "confira com o contador". (Task 1)

---

### Task 1: Tabelas do Simples e preço por unidades

**Files:**
- Create: `apps/crm-web/src/app/crm/impostos/simples-nacional.ts`
- Test: `apps/crm-web/src/app/crm/impostos/simples-nacional.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Anexo = 'III' | 'V';
  export type ModoAnexo = 'fator_r' | 'III' | 'V';
  export interface Partilha { irpj: number; csll: number; cofins: number; pis: number; cpp: number; iss: number } // frações, somam 1
  export interface ResultadoSimples {
    anexo: Anexo; faixa: number;            // 1..6
    rbt12: number; aliquotaEfetiva: number; // fração (0.06 = 6%)
    partilha: Partilha;
    limiteFaixa: number;                    // teto da faixa atual (180000, 360000…)
    acimaDeUmPontoOitoMi: boolean;          // rbt12 > 1.800.000 → aviso
  }
  export function anexoPorFatorR(folha12: number, rbt12: number): Anexo;
  export function calcularSimples(rbt12: number, anexo: Anexo): ResultadoSimples;
  export function precoMensalPorUnidades(unidades: number): number;
  export const TAXA_IMPLANTACAO = 490;
  export const FATOR_R_MINIMO = 0.28;
  ```

- [ ] **Step 1: Criar o branch**

```bash
(já feito: worktree C:/w/imp no branch feat/crm-impostos, base origin/master b03d63d5)
```

- [ ] **Step 2: Write the failing tests** (`describe('simples-nacional')`)

```ts
it('faixa 1 do Anexo III dá 6%', () => {
  const r = calcularSimples(146490, 'III');
  expect(r.faixa).toBe(1); expect(r.aliquotaEfetiva).toBeCloseTo(0.06, 6); expect(r.limiteFaixa).toBe(180000);
});
it('faixa 2 do Anexo III usa a parcela a deduzir', () => {
  expect(calcularSimples(300000, 'III').aliquotaEfetiva).toBeCloseTo(0.0808, 6);
});
it('Anexo V faixa 1 dá 15,5%', () => {
  expect(calcularSimples(146490, 'V').aliquotaEfetiva).toBeCloseTo(0.155, 6);
});
it('180.000 ainda é faixa 1; 180.000,01 é faixa 2', () => {
  expect(calcularSimples(180000, 'III').faixa).toBe(1);
  expect(calcularSimples(180000.01, 'III').faixa).toBe(2);
});
it('receita zero usa a alíquota nominal da faixa 1', () => {
  expect(calcularSimples(0, 'III').aliquotaEfetiva).toBe(0.06);
});
it('marca aviso acima de 1,8 mi', () => {
  expect(calcularSimples(1800000, 'III').acimaDeUmPontoOitoMi).toBe(false);
  expect(calcularSimples(2000000, 'III').acimaDeUmPontoOitoMi).toBe(true);
});
it('partilha de todas as faixas soma 100%', () => {
  for (const anexo of ['III', 'V'] as const)
    for (const rbt of [100000, 200000, 500000, 1000000, 2000000, 4000000]) {
      const p = calcularSimples(rbt, anexo).partilha;
      expect(p.irpj + p.csll + p.cofins + p.pis + p.cpp + p.iss).toBeCloseTo(1, 6);
    }
});
it('Fator R: 28% exatos vai para o III; abaixo vai para o V', () => {
  expect(anexoPorFatorR(28000, 100000)).toBe('III');
  expect(anexoPorFatorR(27999, 100000)).toBe('V');
  expect(anexoPorFatorR(0, 0)).toBe('III'); // sem receita: sem imposto, escolha neutra
});
it('preço por unidades segue os exemplos do site', () => {
  expect([20, 30, 60, 80, 120, 150, 0].map(precoMensalPorUnidades))
    .toEqual([298, 298, 595, 773, 1129, 1486, 0]);
});
```

- [ ] **Step 3: Run to see it fail**

Run: `cd click-cond-web && npx nx test crm-web --testPathPattern=simples-nacional`
Expected: FAIL (módulo não existe)

- [ ] **Step 4: Implement** `simples-nacional.ts` com as tabelas de Global Constraints (percentuais guardados como frações). Acima de 4.800.000 usar a faixa 6. `precoMensalPorUnidades`: `unidades <= 0` → 0; arredondar a 2 casas.

- [ ] **Step 5: Run to see it pass** — mesmo comando, Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/crm-web/src/app/crm/impostos/simples-nacional*.ts
git commit -m "feat(crm): tabelas do Simples Nacional e preço por unidades"
```

---

### Task 2: Apuração da receita a partir das faturas

**Files:**
- Create: `apps/crm-web/src/app/crm/impostos/apuracao-receita.ts`
- Test: `apps/crm-web/src/app/crm/impostos/apuracao-receita.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface FaturaReceita { referencia: string; valor: number } // referencia 'MM/AAAA'
  export interface ApuracaoReceita {
    mesApuracao: string;       // 'MM/AAAA'
    receitaMes: number;        // faturas do próprio mês
    rbt12: number;             // 12 meses anteriores (ou proporcionalizada)
    mesesConsiderados: number; // meses de atividade dentro da janela
    proporcionalizada: boolean;
    semDados: boolean;         // nenhuma fatura no mês nem na janela
  }
  export function apurarReceita(faturas: FaturaReceita[], mesApuracao: string, inicioAtividade: string | null): ApuracaoReceita;
  export function mesAtualBrasilia(agora?: Date): string; // 'MM/AAAA' no fuso America/Sao_Paulo
  ```

Regra (LC 123, art. 18, §§ 1º-2º): janela = 12 meses anteriores ao mês de apuração. Início da atividade = `inicioAtividade` ou, se nulo, a referência mais antiga das faturas. Se os meses de atividade antes do mês de apuração forem < 12: `rbt12 = (soma da janela ÷ n) × 12`; se n = 0 (primeiro mês): `rbt12 = receitaMes × 12`.

- [ ] **Step 1: Write the failing tests**

```ts
const f = (referencia: string, valor: number) => ({ referencia, valor });
it('12 meses cheios somam direto, sem o mês corrente', () => {
  const meses = ['11/2025','12/2025','01/2026','02/2026','03/2026','04/2026','05/2026','06/2026','07/2026','08/2026','09/2026','10/2026'];
  const r = apurarReceita([...meses.map((m) => f(m, 12000)), f('11/2026', 5000), f('10/2025', 99999)], '11/2026', '01/2024');
  expect(r.rbt12).toBe(144000); expect(r.receitaMes).toBe(5000);
  expect(r.mesesConsiderados).toBe(12); expect(r.proporcionalizada).toBe(false);
});
it('menos de 12 meses: média × 12', () => {
  const r = apurarReceita([f('08/2026', 10000), f('09/2026', 10000), f('10/2026', 10000)], '11/2026', '08/2026');
  expect(r.rbt12).toBe(120000); expect(r.mesesConsiderados).toBe(3); expect(r.proporcionalizada).toBe(true);
});
it('primeiro mês: receita do mês × 12', () => {
  expect(apurarReceita([f('11/2026', 773)], '11/2026', '11/2026').rbt12).toBe(9276);
});
it('sem início informado usa a fatura mais antiga', () => {
  expect(apurarReceita([f('09/2026', 6000), f('10/2026', 6000)], '11/2026', null).rbt12).toBe(72000);
});
it('sem faturas marca semDados', () => {
  const r = apurarReceita([], '11/2026', null);
  expect(r.semDados).toBe(true); expect(r.rbt12).toBe(0);
});
it('ignora referência malformada', () => {
  expect(apurarReceita([f('2026-10', 500), f('10/2026', 1000)], '11/2026', '10/2026').rbt12).toBe(12000);
});
it('mesAtualBrasilia usa o fuso de São Paulo', () => {
  expect(mesAtualBrasilia(new Date('2026-12-01T02:00:00Z'))).toBe('11/2026');
});
```

- [ ] **Step 2: Run to see it fail** — `npx nx test crm-web --testPathPattern=apuracao-receita`, Expected: FAIL.
- [ ] **Step 3: Implement** `apuracao-receita.ts` (comparar meses pelo índice `ano*12 + mês`).
- [ ] **Step 4: Run to see it pass** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(crm): apuração da receita de 12 meses a partir das faturas"`

---

### Task 3: Store — configuração e cálculo do mês

**Files:**
- Modify: `apps/crm-web/src/app/crm/crm.store.ts` (`carregarConfigAutomacoes`, ~linha 357; novos signals junto de `configPlanos`, ~linha 91)
- Modify: `apps/crm-web/src/app/crm/crm.models.ts` (interfaces novas)
- Test: `apps/crm-web/src/app/crm/impostos/imposto-mes.spec.ts`
- Create: `apps/crm-web/src/app/crm/impostos/imposto-mes.ts`

**Interfaces:**
- Consumes: Task 1 e Task 2.
- Produces:
  ```ts
  // crm.models.ts
  export interface ConfigImposto { modoAnexo: ModoAnexo; folhaMensal: number; inicioAtividade: string | null }
  // imposto-mes.ts
  export interface ImpostoCliente { clienteId: number; nome: string; mensalidade: number; imposto: number; liquido: number }
  export interface ImpostoMes {
    apuracao: ApuracaoReceita; simples: ResultadoSimples;
    fatorR: number | null;           // folha12 / rbt12; null quando rbt12 = 0
    folhaNaoInformada: boolean;      // modo fator_r e folha 0
    receitaMes: number; receitaMesPeloMrr: boolean;
    das: number;                     // receitaMes × aliquotaEfetiva
    porTributo: { tributo: string; valor: number; reforma: string }[];
    porCliente: ImpostoCliente[];    // ordenado por mensalidade desc
    faturasPodemEstarCortadas: boolean;
  }
  export function calcularImpostoMes(entrada: {
    faturas: FaturaReceita[]; totalFaturasCarregadas: number;
    clientes: { id: number; nome: string; mrr: number; ativo: boolean }[];
    mrrTotal: number; config: ConfigImposto; mesApuracao: string;
  }): ImpostoMes;
  export function lerConfigImposto(cfg: Record<string, string>): ConfigImposto;
  // CrmStore
  readonly configImposto: WritableSignal<ConfigImposto>;
  readonly impostoMes: Signal<ImpostoMes>;
  readonly salvandoConfigImposto: WritableSignal<boolean>;
  salvarConfigImposto(c: ConfigImposto): void; // POST /crm/config com as 3 chaves; toast de sucesso/erro
  ```

Colunas "com a Reforma" de `porTributo` (texto fixo): CPP "continua"; ISS "vira IBS (2029–2033)"; PIS e Cofins "viram CBS (2027)"; IRPJ e CSLL "continua". Folha de 12 meses = `folhaMensal × 12`. `receitaMes = 0` → usa `mrrTotal` e marca `receitaMesPeloMrr`.

- [ ] **Step 1: Write the failing tests**

```ts
const base = { faturas: [], totalFaturasCarregadas: 0, clientes: [], mrrTotal: 0, mesApuracao: '11/2026',
  config: { modoAnexo: 'III' as const, folhaMensal: 0, inicioAtividade: null } };
it('DAS do mês = receita do mês × alíquota efetiva', () => {
  const r = calcularImpostoMes({ ...base, faturas: [{ referencia: '11/2026', valor: 11595 }] });
  expect(r.das).toBeCloseTo(695.7, 2);
});
it('sem faturas no mês usa o MRR e marca', () => {
  const r = calcularImpostoMes({ ...base, mrrTotal: 773 });
  expect(r.receitaMes).toBe(773); expect(r.receitaMesPeloMrr).toBe(true);
});
it('fator_r sem folha cai no Anexo V e avisa', () => {
  const r = calcularImpostoMes({ ...base, faturas: [{ referencia: '10/2026', valor: 10000 }],
    config: { modoAnexo: 'fator_r', folhaMensal: 0, inicioAtividade: null } });
  expect(r.simples.anexo).toBe('V'); expect(r.folhaNaoInformada).toBe(true);
});
it('imposto por cliente ignora inativos', () => {
  const r = calcularImpostoMes({ ...base, clientes: [
    { id: 1, nome: 'A', mrr: 773, ativo: true }, { id: 2, nome: 'B', mrr: 298, ativo: false }] });
  expect(r.porCliente).toEqual([{ clienteId: 1, nome: 'A', mensalidade: 773, imposto: 46.38, liquido: 726.62 }]);
});
it('500 faturas carregadas acende o aviso de corte', () => {
  expect(calcularImpostoMes({ ...base, totalFaturasCarregadas: 500 }).faturasPodemEstarCortadas).toBe(true);
});
it('lerConfigImposto tolera valores ruins', () => {
  expect(lerConfigImposto({ imposto_anexo: 'xyz', imposto_folha_mensal: '-5', imposto_inicio_atividade: '13/2026' }))
    .toEqual({ modoAnexo: 'fator_r', folhaMensal: 0, inicioAtividade: null });
  expect(lerConfigImposto({ imposto_anexo: 'V', imposto_folha_mensal: '4500.50', imposto_inicio_atividade: '03/2025' }))
    .toEqual({ modoAnexo: 'V', folhaMensal: 4500.5, inicioAtividade: '03/2025' });
});
```

- [ ] **Step 2: Run to see it fail** — `npx nx test crm-web --testPathPattern=imposto-mes`, Expected: FAIL.
- [ ] **Step 3: Implement** `imposto-mes.ts` (valores monetários arredondados a 2 casas).
- [ ] **Step 4: Ligar no store**: `configImposto = signal(lerConfigImposto({}))`; em `carregarConfigAutomacoes` chamar `this.configImposto.set(lerConfigImposto(cfg))`; `impostoMes = computed(...)` com `faturas()`, `clientes()`, `overview()?.mrrTotal ?? 0` e `mesAtualBrasilia()`; `salvarConfigImposto` no padrão de `salvandoConfigPlanos`.
- [ ] **Step 5: Run** `npx nx test crm-web` — Expected: todos PASS (incluindo os specs antigos).
- [ ] **Step 6: Commit** — `git commit -m "feat(crm): cálculo do imposto do mês no store"`

---

### Task 4: Aba Impostos, rota, menu e cartão na Visão geral

**Files:**
- Create: `apps/crm-web/src/app/crm/tabs/crm-impostos.component.ts` e `.html`
- Modify: `apps/crm-web/src/app/app.routes.ts` (filho `impostos` de `painel`, depois de `faturamento`)
- Modify: `apps/crm-web/src/app/crm/crm-page.component.ts` (`navItens`: `{ rota: 'impostos', label: 'Impostos', labelCurto: 'Impostos', icone: <heroicon "receipt-percent"> }` depois de Faturamento)
- Modify: `apps/crm-web/src/app/crm/tabs/crm-overview.component.html` (faixa clicável logo abaixo dos 4 KPIs: "Imposto estimado do mês: R$ X (Y%)" com `routerLink="../impostos"`; não virar 5º KPI para não quebrar a grade de 4)

**Interfaces:**
- Consumes: `CrmStore.impostoMes`, `configImposto`, `salvarConfigImposto`, `salvandoConfigImposto`; `precoMensalPorUnidades`, `TAXA_IMPLANTACAO`, `calcularSimples` (Task 1); `moeda` de `crm-format.ts`; `app-kpi-card`, `app-empty-state`.

Conteúdo da aba, nesta ordem (seguir as classes `card`, `badge-*`, `stat-value` das outras abas):
1. 4 `app-kpi-card`: "Receita 12 meses" (detalhe "proporcionalizada" quando for), "Faixa" (`F{n} · Anexo {anexo}`), "Alíquota efetiva" (%, 2 casas), "DAS estimado do mês" (detalhe "pelo MRR" quando `receitaMesPeloMrr`).
2. Avisos (um bloco `badge-warning` por condição): folha não informada; receita acima de 1,8 mi; faturas possivelmente cortadas; `semDados` → `app-empty-state` no lugar da tela.
3. "Próxima faixa": `limiteFaixa − rbt12` e a alíquota efetiva que vale logo acima do limite (`calcularSimples(limiteFaixa + 1, anexo)`).
4. Tabela por tributo: tributo, valor no mês, "com a Reforma"; rodapé: "No Simples o total não muda com a Reforma."
5. Tabela por cliente: condomínio, mensalidade, imposto, líquido; linha de total.
6. Simulador: input de unidades (padrão 80) → mensalidade, imposto e líquido com a alíquota atual; implantação R$ 490 → imposto e líquido.
7. Configuração: select do anexo (Pelo Fator R / Anexo III / Anexo V), folha + pró-labore mensal (R$), início da atividade (MM/AAAA); botão Salvar desabilitado enquanto `salvandoConfigImposto`; mostra o Fator R calculado.
8. Rodapé fixo: "Estimativa. Confirme os valores com o seu contador."

- [ ] **Step 1: Implementar componente, rota, menu e faixa da Visão geral.**
- [ ] **Step 2: Build** — `npx nx build crm-web` — Expected: sucesso, sem erros de template.
- [ ] **Step 3: Testes** — `npx nx test crm-web` — Expected: PASS.
- [ ] **Step 4: Conferir na tela** — não há backend local (sem Docker): servir com um proxy temporário (arquivo no scratchpad, fora do repo) apontando `/api` para a API de produção, com o mesmo mapeamento do rewrite do Vercel do CRM; `npx nx serve crm-web --proxy-config=<arquivo>`. O dono faz o login (eu não digito senha). Conferir `/painel/impostos` e `/painel/overview` em 390 px e desktop. Salvar a configuração só com o OK do dono, porque grava no `Crm_Config` de produção.
- [ ] **Step 5: Commit** — `git commit -m "feat(crm): aba Impostos com simulador e cartão na visão geral"`

---

### Task 5: Publicação (só com o OK do dono)

- [ ] **Step 1:** Perguntar ao dono antes de publicar.
- [ ] **Step 2:** Com o OK: merge em `master`, push de `master` e `main` (o Vercel do CRM segue `main`; ver memória "Branches: master e main").
- [ ] **Step 3:** Abrir `https://crm-click-prestare.vercel.app/painel/impostos` depois do deploy e conferir que carrega com os dados reais.
