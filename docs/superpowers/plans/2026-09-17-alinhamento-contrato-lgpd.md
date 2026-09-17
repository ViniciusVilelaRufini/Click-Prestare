# Alinhamento ao Contrato Prestare Gestão e DPA (LGPD) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adequar a plataforma Prestare Gestão às obrigações contratuais e do DPA (LGPD): exportação completa de dados do condomínio em `.zip`/CSV, revogação do consentimento biométrico com desprovisionamento real de hardware facial e retry, gestão de consentimento de terceiros na portaria e bloqueio rígido de contas e biometria para menores de 18 anos.

**Architecture:** Módulo de exportação compactada no NestJS gerando CSVs UTF-8 com BOM; camada de revogação biométrica append-only conectada a `FacialService.unsyncMorador()` com suporte a falhas de hardware (`pending_removal`); endpoints e validações de terceiros integrados ao `ConsentimentosTerceirosService`; e utilitário centralizado de cálculo de maioridade aplicando travas em `Users`, `Moradores` e terminais de reconhecimento facial.

**Tech Stack:** NestJS 11, Prisma 6 (MySQL), TypeScript 5.7, Angular 21 (Portaria Web), Jest, Archiver / Stream ZIP.

**Spec:** `docs/superpowers/specs/2026-09-17-alinhamento-contrato-lgpd-design.md`

## Global Constraints

- Todas as tabelas de consentimento (`Consentimentos` e `Consentimentos_Terceiros`) são **estritamente append-only** — revogações são registradas como novas linhas com `aceito = 0`, nunca atualizações in-place.
- A exportação de dados do condomínio (`/condominios/:idCondominio/export`) é **exclusiva do perfil Síndico** (`assertSindico`).
- Menores de 18 anos **não podem possuir conta de usuário (`Users`) nem biometria facial (`face_id`)** sob nenhuma hipótese.
- Falhas de comunicação com terminais de reconhecimento facial durante revogação não cancelam a revogação no sistema: o registro é revogado e o status é marcado como `pending_removal` para execução na reconexão.

---

### Task 1: Utilitário de Validação de Maioridade e Testes Unitários

**Files:**
- Create: `click-cond-web/apps/api/src/app/common/idade.util.ts`
- Test: `click-cond-web/apps/api/src/app/common/idade.util.spec.ts`

**Interfaces:**
- Produces:
  - `calcularIdade(dataNascimento: Date | string): number`
  - `validarMaioridade(dataNascimento: Date | string | null | undefined, contexto?: string): void` (lança `BadRequestException` se menor de 18 ou data inválida/ausente quando requerida)

- [ ] **Step 1: Escrever testes unitários para cálculo de idade e validação de maioridade**

```typescript
// click-cond-web/apps/api/src/app/common/idade.util.spec.ts
import { calcularIdade, validarMaioridade } from './idade.util';
import { BadRequestException } from '@nestjs/common';

describe('idade.util', () => {
  it('calcula idade corretamente para maior de 18', () => {
    const vinteAnosAtras = new Date();
    vinteAnosAtras.setFullYear(vinteAnosAtras.getFullYear() - 20);
    expect(calcularIdade(vinteAnosAtras)).toBe(20);
    expect(() => validarMaioridade(vinteAnosAtras)).not.toThrow();
  });

  it('calcula idade corretamente para menor de 18', () => {
    const dezAnosAtras = new Date();
    dezAnosAtras.setFullYear(dezAnosAtras.getFullYear() - 10);
    expect(calcularIdade(dezAnosAtras)).toBe(10);
    expect(() => validarMaioridade(dezAnosAtras, 'biometria')).toThrow(BadRequestException);
  });

  it('lida com aniversariante do dia e dia seguinte', () => {
    const hoje = new Date();
    const fez18Hoje = new Date(hoje.getFullYear() - 18, hoje.getMonth(), hoje.getDate());
    expect(calcularIdade(fez18Hoje)).toBe(18);
    expect(() => validarMaioridade(fez18Hoje)).not.toThrow();

    const faz18Amanha = new Date(hoje.getFullYear() - 18, hoje.getMonth(), hoje.getDate() + 1);
    expect(calcularIdade(faz18Amanha)).toBe(17);
    expect(() => validarMaioridade(faz18Amanha)).toThrow(BadRequestException);
  });

  it('lança BadRequestException se data de nascimento for ausente ou inválida', () => {
    expect(() => validarMaioridade(null)).toThrow(BadRequestException);
    expect(() => validarMaioridade('')).toThrow(BadRequestException);
    expect(() => validarMaioridade('data-invalida')).toThrow(BadRequestException);
  });
});
```

- [ ] **Step 2: Executar testes para verificar falha**

Run: `npx jest --config apps/api/jest.config.cts apps/api/src/app/common/idade.util.spec.ts`
Expected: FAIL ("Cannot find module './idade.util'")

- [ ] **Step 3: Implementar `idade.util.ts`**

```typescript
// click-cond-web/apps/api/src/app/common/idade.util.ts
import { BadRequestException } from '@nestjs/common';

export function parseDataGenerica(data: Date | string | null | undefined): Date | null {
  if (!data) return null;
  if (data instanceof Date) return isNaN(data.getTime()) ? null : data;
  const str = String(data).trim();
  if (!str) return null;

  // DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) {
    const [d, m, y] = str.split('/').map(Number);
    const parsed = new Date(y, m - 1, d);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  // YYYY-MM-DD
  const parsed = new Date(str);
  return isNaN(parsed.getTime()) ? null : parsed;
}

export function calcularIdade(dataNascimento: Date | string): number {
  const d = parseDataGenerica(dataNascimento);
  if (!d) return 0;

  const hoje = new Date();
  let idade = hoje.getFullYear() - d.getFullYear();
  const m = hoje.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && hoje.getDate() < d.getDate())) {
    idade--;
  }
  return Math.max(0, idade);
}

export function validarMaioridade(dataNascimento: Date | string | null | undefined, contexto = 'cadastro'): void {
  const d = parseDataGenerica(dataNascimento);
  if (!d) {
    throw new BadRequestException(
      `A data de nascimento é obrigatória para ${contexto} conforme os termos contratuais e a LGPD.`,
    );
  }

  const idade = calcularIdade(d);
  if (idade < 18) {
    throw new BadRequestException(
      `Operação não permitida para menores de 18 anos (${idade} anos identificados). Cláusula 8.3 do contrato veda contas e biometria de menores.`,
    );
  }
}
```

- [ ] **Step 4: Executar testes para verificar aprovação**

Run: `npx jest --config apps/api/jest.config.cts apps/api/src/app/common/idade.util.spec.ts`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add click-cond-web/apps/api/src/app/common/idade.util.ts click-cond-web/apps/api/src/app/common/idade.util.spec.ts
git commit -m "feat(api): adiciona utilitario de calculo de idade e validacao de maioridade"
```

---

### Task 2: Bloqueio de Menores de 18 Anos em Usuários e Biometria Facial

**Files:**
- Modify: `click-cond-web/apps/api/src/app/moradores/moradores.service.ts`
- Modify: `click-cond-web/apps/api/src/app/auth/mobile-auth.service.ts`
- Modify: `click-cond-web/apps/api/src/app/facial/facial.service.ts`
- Test: `click-cond-web/apps/api/src/app/moradores/moradores-idade.spec.ts`

**Interfaces:**
- Consumes: `validarMaioridade`, `calcularIdade` de `idade.util.ts`
- Produces:
  - `MoradoresService.create` e `update`: rejeita login e foto se idade < 18
  - `MobileAuthService.insertMorador` e `saveMorador`: rejeita login e foto se idade < 18
  - `FacialService.syncMorador`: pula sincronização se idade < 18 com `{ skipped: true, reason: 'menor_de_idade' }`

- [ ] **Step 1: Escrever testes unitários em `moradores-idade.spec.ts`**
- [ ] **Step 2: Rodar testes e verificar falha**
- [ ] **Step 3: Aplicar as validações em `moradores.service.ts`, `mobile-auth.service.ts` e `facial.service.ts`**
- [ ] **Step 4: Rodar testes e verificar aprovação**
- [ ] **Step 5: Commit**

---

### Task 3: Finalização do Módulo de Consentimento de Terceiros na API

**Files:**
- Modify: `click-cond-web/apps/api/src/app/consentimentos/consentimentos.controller.ts`
- Modify: `click-cond-web/apps/api/src/app/consentimentos/consentimentos.module.ts`
- Test: `click-cond-web/apps/api/src/app/consentimentos/consentimentos-terceiros.spec.ts`

**Interfaces:**
- Consumes: `ConsentimentosTerceirosService`
- Produces:
  - `POST /condominios/:idCondominio/consentimentos/terceiros`
  - `GET /condominios/:idCondominio/consentimentos/terceiros/status`

- [ ] **Step 1: Adicionar testes de rotas de terceiros**
- [ ] **Step 2: Rodar testes e verificar falha**
- [ ] **Step 3: Adicionar endpoints de terceiros no `ConsentimentosController` com decoradores de tenant e permissão de operador**
- [ ] **Step 4: Rodar testes e verificar aprovação**
- [ ] **Step 5: Commit**

---

### Task 4: Revogação de Consentimento Biométrico com Exclusão em Hardware e Retry

**Files:**
- Modify: `click-cond-web/apps/api/src/app/consentimentos/consentimentos.service.ts`
- Modify: `click-cond-web/apps/api/src/app/consentimentos/consentimentos.controller.ts`
- Test: `click-cond-web/apps/api/src/app/consentimentos/consentimentos.spec.ts`

**Interfaces:**
- Consumes: `FacialService.unsyncMorador()`
- Produces:
  - `ConsentimentosService.revogarBiometria(idUser, operadorNome)`
  - `POST /consentimentos/revogar-biometria` (app móvel)
  - `POST /condominios/:idCondominio/moradores/:idMorador/revogar-biometria` (painel web)

- [ ] **Step 1: Adicionar testes de revogação em `consentimentos.spec.ts`**
- [ ] **Step 2: Rodar testes e verificar falha**
- [ ] **Step 3: Implementar `revogarBiometria` no `ConsentimentosService` chamando `unsyncMorador` e tratando status `revoked` / `pending_removal`**
- [ ] **Step 4: Rodar testes e verificar aprovação**
- [ ] **Step 5: Commit**

---

### Task 5: Serviço e Endpoint de Exportação Completa de Dados do Condomínio (LGPD)

**Files:**
- Create: `click-cond-web/apps/api/src/app/relatorios/condominios-export.service.ts`
- Create: `click-cond-web/apps/api/src/app/relatorios/condominios-export.service.spec.ts`
- Modify: `click-cond-web/apps/api/src/app/relatorios/relatorios.controller.ts`
- Modify: `click-cond-web/apps/api/src/app/relatorios/relatorios.module.ts`

**Interfaces:**
- Produces:
  - `CondominiosExportService.gerarPacoteExportacao(idCondominio: number): Promise<{ stream: Readable, filename: string }>`
  - `GET /condominios/:idCondominio/export` (exclusivo para `assertSindico`)

- [ ] **Step 1: Escrever testes unitários em `condominios-export.service.spec.ts`**
- [ ] **Step 2: Rodar testes e verificar falha**
- [ ] **Step 3: Implementar geração de CSVs com BOM (UTF-8) e compactação ZIP no `CondominiosExportService`**
- [ ] **Step 4: Integrar rota no `RelatoriosController` e registrar evento no `AuditLog`**
- [ ] **Step 5: Rodar testes e verificar aprovação**
- [ ] **Step 6: Commit**

---

### Task 6: Atualizações na Interface Web da Portaria e Síndico (`portaria-web`)

**Files:**
- Modify: `click-cond-web/apps/portaria-web/src/app/moradores/moradores-page.component.html` & `.ts`
- Modify: `click-cond-web/apps/portaria-web/src/app/visitantes/visitantes.component.ts` (ou modal correspondente)
- Modify: `click-cond-web/apps/portaria-web/src/app/relatorios/relatorios.component.html` & `.ts`

**Interfaces:**
- Produces:
  - Campo Data de Nascimento e trava visual para menores no cadastro de moradores
  - Checkbox de declaração de biometria de terceiros na captura de fotos
  - Botão "Exportação Completa (LGPD)" no painel do síndico
  - Botão "Revogar Biometria" na visualização do morador

- [ ] **Step 1: Adicionar campo Data de Nascimento e reatividade de menoridade no modal de moradores**
- [ ] **Step 2: Adicionar checkbox de autorização biométrica no cadastro de visitantes com foto**
- [ ] **Step 3: Adicionar botão de download do pacote de exportação (.zip) para o síndico**
- [ ] **Step 4: Adicionar botão e chamada de revogação de biometria do morador**
- [ ] **Step 5: Testar visualmente/compilar a aplicação web**
- [ ] **Step 6: Commit**
