# Encomenda com foto e leitura da etiqueta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Foto da encomenda no cadastro da portaria web, com leitura da etiqueta por IA preenchendo o formulário (o porteiro confirma), e a foto exibida em degradê na lista web e no cartão do app.

**Architecture:** Endpoint novo e somente leitura na API (`ler-etiqueta`) usa o `IaClient` existente (Bedrock em produção) e casa o nome lido com os moradores do condomínio. A web reduz a imagem, chama o endpoint, preenche só campos vazios e manda a foto em `foto_volume` no POST que já existe. Web e app só passam a desenhar `foto_volume`.

**Tech Stack:** NestJS + Prisma (API), Angular 21 + Jest (portaria-web), Flutter (app).

**Spec:** `docs/superpowers/specs/2026-11-10-encomenda-foto-etiqueta-design.md`

## Global Constraints

- Leitura **preenche e o porteiro confirma**; o endpoint nunca grava nem notifica.
- Sem migração: usa `Encomendas.foto_volume` existente.
- Imagem aceita: data URL JPEG/PNG/WebP, até 5 MB.
- Redução no navegador: lado maior 1280px, JPEG qualidade 0,8.
- Preenche só campos ainda vazios; aviso exato: "Preenchido pela etiqueta — confira".
- Qualquer falha (IA fora, timeout, JSON inválido) volta ao formulário manual sem erro bloqueante.
- Não logar a imagem nem o conteúdo lido.
- Rotas da portaria exigem `assertOperador`.

## Review Focus

1. Etiqueta com nome que casa com dois moradores de aptos diferentes → não escolher um ao acaso: sem destinatário, a menos que apto/bloco lidos desempatem.
2. IA devolve texto com cercas ```json ou lixo → parse tolerante; lixo vira leitura vazia, sem 500.
3. Porteiro já escolheu o destinatário antes da foto → a leitura não sobrescreve.
4. Foto grande (12 MP do celular) → reduzida antes do envio; nunca passa de 5 MB.
5. Encomenda sem foto (todas as antigas) → lista web e app exatamente como hoje.

---

### Task 1: API — `POST condominios/:idCondominio/encomendas/ler-etiqueta`

**Files:**
- Create: `click-cond-web/apps/api/src/app/encomendas/ler-etiqueta.ts` (funções puras: `extrairLeitura`, `casarMorador`)
- Modify: `click-cond-web/apps/api/src/app/encomendas/encomendas.controller.ts`, `encomendas.service.ts`, `encomendas.module.ts` (prover `IaClient`, `BedrockClient`, `GeminiClient`)
- Test: `click-cond-web/apps/api/src/app/encomendas/ler-etiqueta.spec.ts`

**Interfaces:**
- Produces:
  - `interface LeituraEtiqueta { nome: string|null; apto: string|null; bloco: string|null; transportadora: string|null; codigo_rastreio: string|null; descricao: string|null }`
  - `extrairLeitura(texto: string): LeituraEtiqueta` — aceita JSON puro ou dentro de cerca ```; inválido → todos null.
  - `casarMorador(leitura: LeituraEtiqueta, moradores: {nome: string; apartamento: string|null; bloco: string|null}[]): {apto: string; bloco: string|null; nome: string} | null`
  - `EncomendasService.lerEtiqueta(idCondominio: number, imagem: string): Promise<{ leitura: LeituraEtiqueta; destinatario: {apto; bloco; nome} | null }>`
  - Resposta HTTP 200 com esse objeto; 400 se imagem não for data URL de imagem aceita ou > 5 MB.

- [ ] **Step 1: Testes (falham)** em `ler-etiqueta.spec.ts`:
  - `extrairLeitura('```json\n{"nome":"Rafael Costa","apto":"106"}\n```')` → `nome: 'Rafael Costa'`, `apto: '106'`, demais null.
  - `extrairLeitura('não sei')` → todos null.
  - `casarMorador({nome:'RAFAEL COSTA', ...}, [{nome:'Rafael Costa Teste', apartamento:'106', bloco:'A'}])` → `{apto:'106', bloco:'A', nome:'Rafael Costa Teste'}` (sem acento, minúsculo, ≥2 palavras em comum ou nome inteiro contido).
  - Dois moradores com "Rafael Costa" em aptos 106 e 201, leitura sem apto → `null`; leitura com `apto:'201'` → o de 201.
  - Nome sem correspondência mas `apto:'106', bloco:'A'` que existem → `{apto:'106', bloco:'A', nome:<primeiro morador desse apto>}`.
  - Service: IA mockada lança erro → `{ leitura: <tudo null>, destinatario: null }`; imagem `data:text/plain,...` → `BadRequestException`.
- [ ] **Step 2:** `node_modules/.bin/jest -c apps/api/jest.config.cts apps/api/src/app/encomendas/ler-etiqueta.spec.ts` → FAIL (módulo inexistente).
- [ ] **Step 3:** Implementar. `lerEtiqueta` monta `contents = [{ role: 'user', parts: [{ text: PROMPT }, { inlineData: { mimeType, data: base64 } }] }]` e chama `iaClient.gerarComFerramentas(contents, [], INSTRUCAO)`; PROMPT pede só o JSON com as 6 chaves (null quando ilegível). Moradores: `prisma.moradores.findMany({ where: { id_condominio }, select: { nome, apartamento, bloco } })`. Controller: `@Post('ler-etiqueta')` com `assertOperador(user, 'ler etiqueta de encomenda')`, `@SkipAudit()`.
- [ ] **Step 4:** mesmo comando → PASS; `tsc -p apps/api/tsconfig.app.json --noEmit` sem erros.
- [ ] **Step 5:** Commit `feat(api): leitura da etiqueta da encomenda por IA`.

### Task 2: Web — foto e leitura na gaveta "Receber nova encomenda"

**Files:**
- Create: `click-cond-web/apps/portaria-web/src/app/encomendas/foto-encomenda.ts` (`reduzirImagem(file: File, ladoMax = 1280, qualidade = 0.8): Promise<string>`, `aplicarLeitura(...)`)
- Modify: `encomendas.service.ts` (`CreateEncomenda.foto_volume?: string`; `lerEtiqueta(imagem: string): Observable<{leitura; destinatario}>`; `Encomenda.foto_volume?: string|null`), `encomendas-page.component.ts/.html`
- Test: `click-cond-web/apps/portaria-web/src/app/encomendas/foto-encomenda.spec.ts`

**Interfaces:**
- Consumes: resposta da Task 1.
- Produces: `aplicarLeitura(novo: CreateEncomenda, selecionado: Apartamento|null, apartamentos: Apartamento[], r: {leitura; destinatario}): { novo: CreateEncomenda; selecionado: Apartamento|null; preencheu: boolean }` — função pura.

- [ ] **Step 1: Testes (falham)**:
  - Formulário vazio + destinatário `{apto:'106', bloco:'A'}` existente em `apartamentos` → `selecionado` é esse apto; `recebido_de`, `codigo_rastreio`, `descricao` vindos da leitura; `preencheu: true`.
  - `descricao` já digitada e `selecionado` já escolhido → continuam os do porteiro.
  - Destinatário que não existe em `apartamentos` → `selecionado` inalterado.
  - Leitura toda null → `preencheu: false`.
- [ ] **Step 2:** `node_modules/.bin/jest -c apps/portaria-web/jest.config.cts apps/portaria-web/src/app/encomendas/foto-encomenda.spec.ts` → FAIL.
- [ ] **Step 3:** Implementar `aplicarLeitura` e `reduzirImagem` (canvas, `toDataURL('image/jpeg', qualidade)`). Na gaveta, bloco "FOTO DA ENCOMENDA" acima do código de rastreio: `<input type="file" accept="image/*" capture="environment">` escondido + botão; prévia da foto; ao escolher: reduzir → `fotoVolume` → "Lendo etiqueta…" → `lerEtiqueta` → `aplicarLeitura`; se `preencheu`, aviso "Preenchido pela etiqueta — confira"; erro silencioso. `salvar()` envia `foto_volume`. Limpar foto/aviso ao fechar e após salvar.
- [ ] **Step 4:** mesmo comando → PASS; `nx build portaria-web --configuration=production` ok.
- [ ] **Step 5:** Commit `feat(portaria-web): foto da encomenda com leitura da etiqueta`.

### Task 3: Web — foto na lista de encomendas

**Files:** Modify `encomendas-page.component.html` (célula do volume), `styles.css` se precisar; Test: `encomendas-page.linha.spec.ts`.

- [ ] **Step 1: Teste (falha)**: linha com `foto_volume: 'https://cdn/x.jpg'` renderiza `.ps-mor-foto img[src="https://cdn/x.jpg"]` dentro da célula do volume; linha sem foto não renderiza `.ps-mor-foto`.
- [ ] **Step 2:** rodar o spec → FAIL.
- [ ] **Step 3:** Usar o mesmo `ps-mor-celula`/`ps-mor-foto` de Visitantes (degradê só na foto) quando houver `foto_volume`.
- [ ] **Step 4:** spec → PASS; suíte portaria-web só com as 2 falhas antigas do simulador.
- [ ] **Step 5:** Commit `feat(portaria-web): foto em degradê na lista de encomendas`.

### Task 4: App — foto no cartão da encomenda

**Files:** Modify `click-cond-app/click-cond-app/lib/pages/shared/encomendas/list_encomendas.dart` (`_EncomendaCard`); Test: `click-cond-app/click-cond-app/test/encomendas/encomenda_card_foto_test.dart`.

- [ ] **Step 1: Teste (falha)**: `ListEncomendas` com API mockada devolvendo uma encomenda com `foto_volume: 'https://cdn/x.jpg'` → há `ShaderMask` com `Image` no cartão; sem `foto_volume` → nenhum `ShaderMask` no cartão.
- [ ] **Step 2:** `flutter test test/encomendas/encomenda_card_foto_test.dart` → FAIL.
- [ ] **Step 3:** Com foto: imagem à esquerda (104dp, ponta a ponta) com o mesmo `ShaderMask` do `CabecalhoPessoa` (branco 0→0,35, transparente em 1) e o texto a partir de 92dp; sem foto, cartão atual.
- [ ] **Step 4:** teste → PASS; `flutter test` só com as 4 falhas antigas de Assembleias.
- [ ] **Step 5:** Commit `feat(app): foto da encomenda em degradê no cartão`.

### Task 5: Conferência

- [ ] Web local (`serve-console-prod.js`) com a foto de uma etiqueta: formulário preenchido e aviso; lista com a foto.
- [ ] App no emulador: cartão com foto.
