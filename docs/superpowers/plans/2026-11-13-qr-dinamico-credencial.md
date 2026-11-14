# QR Code dinâmico como credencial — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Morador e visitante abrem o portão com um QR que muda a cada 30 segundos, validado na nuvem, sem que um print continue valendo.

**Architecture:** Um formato de código curto (`P1` + 26 caracteres base32) é gerado no app a partir de um segredo por credencial e conferido na API, no começo de `runWebhook`. Credencial válida de morador entra direto no fluxo existente; a de visita devolve o PIN da visita e segue pelo caminho que já resolve PIN, de modo que janela, dias, bloqueio, ponte leitor → abertura e registro continuam sendo os de hoje. O visitante usa uma página pública que busca o código atual na API.

**Tech Stack:** NestJS 11 + Prisma 6 (MySQL) em `click-cond-web/apps/api`; Angular 21 em `click-cond-web/apps/portaria-web`; Flutter em `click-cond-app/click-cond-app`; agente Node em `click-cond-web/agent`.

**Spec:** `docs/superpowers/specs/2026-11-13-qr-dinamico-credencial-design.md`

## Global Constraints

- Base: worktree `C:/w/acesso`, branch `feat/acesso-celular` (de `origin/master`, `1241eb15`). Todos os caminhos abaixo são relativos à raiz desse worktree.
- Produção é o NestJS. Não tocar no Express de dev.
- Schema: alterar `click-cond-web/prisma/schema.prisma` **e** criar SQL manual idempotente. Ninguém roda `prisma db push` nem `migrate` contra banco algum neste plano. A aplicação do SQL no RDS é passo de publicação, fora deste plano, e acontece antes do push.
- Todo `POST` chamado pelo app leva `@HttpCode(200)`.
- Rota pública: `@Public()` + `@Throttle(...)` + `@SkipAudit()`.
- Nenhuma variável de ambiente nova: o ambiente do Elastic Beanstalk está no limite de 4096 caracteres. Chaves derivam de `FACIAL_CRED_KEY || JWT_SECRET`.
- O código lido, o segredo e o token do link nunca vão para log, para `Acessos_Facial` nem para serviço de terceiro. Onde hoje se grava a credencial lida, grava-se `cred:<id>` ou `cred:?`.
- Formato do código: `P1` + 26 caracteres base32 (alfabeto RFC 4648 `A-Z2-7`, sem preenchimento), 28 no total; contador = `floor(unix_ms / 30000)`; tolerância de −1 e +1.
- Opção por condomínio `qr_app_habilitado`, **desligada por padrão**.
- Página pública e telas da portaria-web usam o vocabulário Prestare Dark já presente em `convite-page.component.ts` (`app-bg`, `ps-panel`, `ps-h1`, `bg-accent`), sem paleta própria.
- Textos ao usuário em português do Brasil.
- Cada tarefa termina com commit no branch `feat/acesso-celular`, mensagem em português no padrão `feat(credenciais): …` / `fix(...)`, com o rodapé `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Não fazer push.

## Review Focus

1. **Leitor que entrega o código sujo** (minúsculas, espaço, `\r\n` no fim, como fazem leitores USB/serial): deve validar igual ao código limpo. Teste na Tarefa 3.
2. **Duas leituras do mesmo código no mesmo leitor quase juntas** (o leitor dispara duas vezes): uma abre, a outra é reuso negado, sem erro 500. Teste na Tarefa 4.
3. **Relógio do celular errado em minutos:** o código é negado como expirado, e o app corrige a diferença de hora na próxima chamada com internet em vez de ficar negando para sempre. Testes nas Tarefas 4 e 11.
4. **Usuário com linha de morador em dois condomínios ou dois apartamentos:** recebe a credencial do condomínio pedido, e o código de um condomínio não abre no outro. Testes nas Tarefas 4 e 6.
5. **Página do visitante deixada em segundo plano** (o navegador pausa temporizadores): ao voltar ao primeiro plano busca o código na hora, em vez de mostrar um QR vencido por até 25 s. Teste na Tarefa 8.

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `click-cond-web/prisma/schema.prisma` | modelos `Credenciais_Acesso`, `Credenciais_Leituras`; coluna `Condominios.qr_app_habilitado` |
| `click-cond-web/prisma/manual_2026-11_credenciais_acesso.sql` | o mesmo, em SQL idempotente |
| `apps/api/src/app/credenciais/codigo-dinamico.util.ts` | formato: gerar, decodificar, conferir, rotular |
| `apps/api/src/app/credenciais/credenciais-validacao.service.ts` | valida uma leitura; só depende de Prisma |
| `apps/api/src/app/credenciais/credenciais-nucleo.module.ts` | exporta a validação para o `FacialModule` sem ciclo |
| `apps/api/src/app/credenciais/credenciais.service.ts` | emissão, link do visitante, leitura pública, opção do condomínio |
| `apps/api/src/app/credenciais/credenciais.controller.ts` | rotas do app, do síndico e a pública |
| `apps/api/src/app/credenciais/credenciais.module.ts` | importa `VisitantesModule` e o núcleo |
| `apps/api/src/app/facial/facial.service.ts` | chama a validação em `runWebhook`; máscaras; corte do PIN como QR; `abrirDispositivoInterno` |
| `apps/portaria-web/src/app/passe/passe-page.component.ts` | página pública do visitante |
| `apps/portaria-web/src/app/configuracoes/…` | liga/desliga "QR no app" |
| `click-cond-app/click-cond-app/lib/utils/codigo_dinamico.dart` | o mesmo formato em Dart |
| `…/lib/services/credencial_acesso.dart` | guarda segredo e diferença de hora |
| `…/lib/controllers/controller_credencial.dart` | chamadas à API |
| `…/lib/pages/shared/meu_acesso/meu_acesso_page.dart` | tela "Meu acesso" |
| `click-cond-web/agent/src/…` | só no Bloco D |

(Os caminhos `apps/…` são relativos a `click-cond-web/`.)

## Vetores de teste do formato (iguais em TypeScript e Dart)

Segredo A (hex): `000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f`
Segredo B (hex): `ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100`

| id | contador | segredo | código |
|---|---|---|---|
| 1 | 0 | A | `P1AAAAAAIAAAAABALZ4WDJKZ4FNI` |
| 1 | 59000000 | A | `P1AAAAAAIDQRCMABTQCSPWDO5F3Q` |
| 1 | 59000001 | A | `P1AAAAAAIDQRCMDS3DSX2WSX2IVM` |
| 4294967295 | 59000000 | A | `P1777777YDQRCMBFJSPWOFKGKEXQ` |
| 123456 | 59461234 | B | `P1AAA6EQADRNHHENRPXWQLO4XSOQ` |

Montagem: `corpo` = id (uint32 big-endian) | contador (uint32 big-endian); `mac` = primeiros 8 bytes de `HMAC-SHA256(segredo, "P1" em ASCII | corpo)`; código = `"P1"` + base32(`corpo | mac`). Instante `1794614400` s (unix) → contador `59820480`.

---

## Bloco 0 — Bancada

### Task 1: Bancada do leitor de QR embutido (depende de o dono ter o aparelho)

**Files:**
- Create: `docs/operacao/2026-11-bancada-qr-terminal.md`

**Interfaces:**
- Produces: o resultado `CONFIRMA` | `PARCIAL` | `NEGA` | `SEM_APARELHO`, escrito na primeira linha do arquivo. O Bloco D só é executado com `CONFIRMA` ou `PARCIAL`. Com `PARCIAL`, a Tarefa 3 só começa depois de o formato ajustado ser escrito neste plano e no desenho.

Esta tarefa não escreve código de produto. Sem terminal Dahua/Intelbras com leitor de QR disponível, registre `SEM_APARELHO` e siga para o Bloco A: o projeto entrega com leitor avulso.

- [ ] **Step 1: Gerar o QR de teste.** Conteúdo exato: `P1AAAAAAIDQRCMABTQCSPWDO5F3Q` (28 caracteres). Gerar localmente (ex.: `npx qrcode-terminal` ou qualquer gerador offline), sem enviar a serviço de terceiro.
- [ ] **Step 2: Capturar o fluxo bruto de eventos do terminal** com `curl --digest -u <usuario>:<senha> -N "http://<ip>/cgi-bin/eventManager.cgi?action=attach&codes=[All]"` enquanto o QR é mostrado ao leitor. Usar as credenciais do aparelho de bancada; não gravá-las no arquivo.
- [ ] **Step 3: Registrar no arquivo:** modelo e firmware; se algum evento saiu; o `Code` do evento; o valor de `Method` e de `ErrorCode`; em qual campo veio o conteúdo (`CardNo`, `QRCode`, outro); quantos caracteres chegaram e se chegaram intactos; o trecho bruto do evento.
- [ ] **Step 4: Repetir com um conteúdo só de dígitos de 20 caracteres** (`12345678901234567890`) e registrar o mesmo, para saber se há limite de tamanho ou de alfabeto.
- [ ] **Step 5: Escrever o veredito na primeira linha.** `CONFIRMA` = os 28 caracteres chegam intactos. `PARCIAL` = chega evento, mas cortado ou só com dígitos/hex. `NEGA` = nenhum evento traz o conteúdo.
- [ ] **Step 6: Commit** — `docs(credenciais): resultado da bancada do leitor de QR embutido`.

---

## Bloco A — API

### Task 2: Schema e SQL manual

**Files:**
- Modify: `click-cond-web/prisma/schema.prisma` (modelo `Condominios`, perto de `cobranca_auto_whats`; modelos novos ao fim do bloco de acesso, depois de `Acessos_Facial`)
- Create: `click-cond-web/prisma/manual_2026-11_credenciais_acesso.sql`

**Interfaces:**
- Produces (nomes Prisma usados pelas tarefas seguintes):
  - `Condominios.qr_app_habilitado: Boolean @default(false)`
  - `Credenciais_Acesso { id Int @id @default(autoincrement()); id_condominio Int; tipo_pessoa String @db.VarChar(20) /* 'morador' | 'visita' */; id_pessoa Int?; id_visita Int?; id_visitante Int?; segredo String @db.VarChar(255); origem String @default("app") @db.VarChar(20) /* texto curto livre, sem enum nem CHECK: hoje 'app' e 'link'; o projeto 3 acrescenta 'wallet_apple' e 'wallet_google' */; versao_link Int @default(1); valido_de DateTime? @db.DateTime(0); valido_ate DateTime? @db.DateTime(0); revogada_em DateTime? @db.DateTime(0); criado_em DateTime @default(now()) @db.DateTime(0) }` com relação a `Condominios` (`onDelete: Cascade`, map `fk_cred_cond`) e índices `idx_cred_pessoa (id_condominio, tipo_pessoa, id_pessoa, origem)`, `idx_cred_visita (id_visita)`, `idx_cred_visitante (id_visitante)`.
  - `Credenciais_Leituras { id Int @id @default(autoincrement()); id_credencial Int; id_device Int; contador Int; lido_em DateTime @default(now()) @db.DateTime(0) }` com relação a `Credenciais_Acesso` (`onDelete: Cascade`, map `fk_credleit_cred`), `@@unique([id_credencial, id_device, contador], map: "un_credleit")` e `@@index([lido_em], map: "idx_credleit_lido")`.

- [ ] **Step 1: Editar o `schema.prisma`** com os três itens acima. `segredo` guarda o hex do segredo já passado por `encryptSecret` (por isso 255).
- [ ] **Step 2: Escrever o SQL manual.** `CREATE TABLE IF NOT EXISTS` para as duas tabelas (InnoDB, utf8mb4, mesmas colunas, índices e chaves estrangeiras). Para a coluna em `Condominios`, usar o mesmo padrão de `prisma/manual_2026-09_delivery_dados_entregador.sql` (consulta a `information_schema.COLUMNS` + `PREPARE`), com `TINYINT(1) NOT NULL DEFAULT 0`. O arquivo precisa poder rodar duas vezes sem erro.
- [ ] **Step 3: Validar.** Em `click-cond-web`: `npx prisma validate --schema=prisma/schema.prisma` → "The schema at prisma/schema.prisma is valid"; depois `npx prisma generate --schema=prisma/schema.prisma` → sem erro.
- [ ] **Step 4: Typecheck.** `npx nx typecheck api` → sem erros.
- [ ] **Step 5: Commit** — `feat(credenciais): tabelas de credencial de acesso e opção por condomínio`.

### Task 3: Formato do código

**Files:**
- Create: `click-cond-web/apps/api/src/app/credenciais/codigo-dinamico.util.ts`
- Test: `click-cond-web/apps/api/src/app/credenciais/codigo-dinamico.util.spec.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `type PrefixoCodigo = 'P1' | 'P2'`
  - `const INTERVALO_MS = 30_000`
  - `gerarCodigo(prefixo: PrefixoCodigo, id: number, contador: number, segredo: Buffer): string`
  - `normalizarLeitura(valor: string | null | undefined): string` — `trim`, remove `\r`/`\n`/espaços internos, maiúsculas
  - `ehCodigoDinamico(valor: string | null | undefined): boolean` — verdadeiro quando o valor normalizado casa com `^P[12][A-Z2-7]{26}$`
  - `decodificarCodigo(valor: string): { prefixo: PrefixoCodigo; id: number; contador: number; mac: Buffer } | null`
  - `conferirMac(dec: { prefixo: PrefixoCodigo; id: number; contador: number; mac: Buffer }, segredo: Buffer): boolean` — comparação em tempo constante
  - `contadorDe(instante: Date): number`
  - `rotuloDeCredencial(valor: string | null | undefined): string` — `cred:<id>` quando decodifica, `cred:?` quando começa com `P1`/`P2` mas não decodifica, e o próprio valor nos demais casos

- [ ] **Step 1: Escrever os testes que falham**

```ts
const A = Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex');
const B = Buffer.from('ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100', 'hex');

it.each([
  [1, 0, A, 'P1AAAAAAIAAAAABALZ4WDJKZ4FNI'],
  [1, 59000000, A, 'P1AAAAAAIDQRCMABTQCSPWDO5F3Q'],
  [1, 59000001, A, 'P1AAAAAAIDQRCMDS3DSX2WSX2IVM'],
  [4294967295, 59000000, A, 'P1777777YDQRCMBFJSPWOFKGKEXQ'],
  [123456, 59461234, B, 'P1AAA6EQADRNHHENRPXWQLO4XSOQ'],
])('gera o vetor id=%i contador=%i', (id, contador, segredo, esperado) => {
  expect(gerarCodigo('P1', id, contador, segredo)).toBe(esperado);
});

it('decodifica e confere o que gerou', () => {
  const dec = decodificarCodigo('P1AAA6EQADRNHHENRPXWQLO4XSOQ')!;
  expect(dec).toMatchObject({ prefixo: 'P1', id: 123456, contador: 59461234 });
  expect(conferirMac(dec, B)).toBe(true);
  expect(conferirMac(dec, A)).toBe(false);
});

it('aceita leitura suja de leitor (Review Focus 1)', () => {
  const sujo = '  p1aaaaaaidqrcmabtqcspwdo5f3q\r\n';
  expect(ehCodigoDinamico(sujo)).toBe(true);
  expect(decodificarCodigo(sujo)).toMatchObject({ id: 1, contador: 59000000 });
});

it('não confunde PIN nem tag com código dinâmico', () => {
  for (const v of ['123456', 'QR_MORADOR_99827', 'P1', 'P1AAAAAAIDQRCMABTQCSPWDO5F3', 'P3AAAAAAIDQRCMABTQCSPWDO5F3Q', '', null, undefined]) {
    expect(ehCodigoDinamico(v as any)).toBe(false);
  }
  expect(decodificarCodigo('P1AAAAAAIDQRCMABTQCSPWDO5F31')).toBeNull(); // '1' fora do alfabeto
});

it('contador e rótulo', () => {
  expect(contadorDe(new Date(1794614400 * 1000))).toBe(59820480);
  expect(rotuloDeCredencial('P1AAA6EQADRNHHENRPXWQLO4XSOQ')).toBe('cred:123456');
  expect(rotuloDeCredencial('P1!!!')).toBe('cred:?');
  expect(rotuloDeCredencial('123456')).toBe('123456');
});
```

- [ ] **Step 2: Rodar e ver falhar.** Em `click-cond-web`: `npx nx test api --testFile=credenciais/codigo-dinamico.util.spec.ts` → FAIL (módulo inexistente).
- [ ] **Step 3: Implementar as funções do bloco Interfaces** com `node:crypto` (`createHmac`, `timingSafeEqual`). Base32 implementado no próprio arquivo (sem dependência nova), alfabeto `ABCDEFGHIJKLMNOPQRSTUVWXYZ234567`, 16 bytes → 26 caracteres, os 2 bits que sobram no último caractere são zero; na decodificação, caractere fora do alfabeto devolve `null`.
- [ ] **Step 4: Rodar e ver passar** com o mesmo comando → PASS.
- [ ] **Step 5: Commit** — `feat(credenciais): formato do código dinâmico com vetores de teste`.

### Task 4: Validação de uma leitura

**Files:**
- Create: `click-cond-web/apps/api/src/app/credenciais/credenciais-validacao.service.ts`
- Create: `click-cond-web/apps/api/src/app/credenciais/credenciais-nucleo.module.ts`
- Test: `click-cond-web/apps/api/src/app/credenciais/credenciais-validacao.service.spec.ts`

**Interfaces:**
- Consumes: Tarefa 2 (modelos Prisma), Tarefa 3 (`normalizarLeitura`, `decodificarCodigo`, `conferirMac`, `contadorDe`, `rotuloDeCredencial`), `decryptSecret` de `../facial/device-secret.util`, `pessoasMigrationEnabled` de `../common/pessoas-migration.util`, `PrismaService`.
- Produces:
  - `type MotivoNegacao = 'desconhecida' | 'opcao_desligada' | 'revogada' | 'fora_validade' | 'assinatura' | 'expirado' | 'reuso' | 'visita_encerrada' | 'morador_removido'`
  - `const TEXTO_NEGACAO: Record<MotivoNegacao, string>` com exatamente: `desconhecida` → `QR não reconhecido`; `opcao_desligada` → `QR no app desligado neste condomínio`; `revogada` → `QR cancelado`; `fora_validade` → `QR fora da validade`; `assinatura` → `QR inválido`; `expirado` → `QR vencido (mostre o código atual)`; `reuso` → `QR já usado neste leitor`; `visita_encerrada` → `Visita encerrada`; `morador_removido` → `Morador não encontrado`.
  - `type ResultadoLeitura = { ok: true; rotulo: string; idCredencial: number; contador: number; alvo: { tipo: 'morador'; morador: { id: number; nome: string; tipo: string | null } } | { tipo: 'visita'; codigoAcesso: string } } | { ok: false; rotulo: string; motivo: MotivoNegacao }`
  - `class CredenciaisValidacaoService { validarLeitura(valorLido: string, device: { id: number; id_condominio: number }, instante: Date): Promise<ResultadoLeitura>; qrAppHabilitado(idCondominio: number): Promise<boolean> }`
  - `CredenciaisNucleoModule` — `providers` e `exports`: `[CredenciaisValidacaoService]`. Não importa `VisitantesModule` nem `FacialModule` (o `VisitantesModule` importa o `FacialModule`; a validação fica fora desse ciclo).

Ordem das conferências em `validarLeitura` (a primeira que falhar decide o motivo):

1. Decodifica. Não decodifica → `desconhecida`, rótulo `cred:?`.
2. Busca a credencial por `id`. Não existe, ou é de outro condomínio que o do leitor → `desconhecida` (o mesmo motivo nos dois casos, para não revelar que o id existe).
3. `qrAppHabilitado(device.id_condominio)` falso → `opcao_desligada`.
4. `revogada_em` preenchido → `revogada`.
5. Fora de `valido_de`/`valido_ate` (quando preenchidos) → `fora_validade`.
6. MAC não confere com o segredo decifrado → `assinatura`.
7. `|contador − contadorDe(instante)| > 1` → `expirado`.
8. Alvo: `morador` → carrega `Moradores` por `id_pessoa`; ausente ou `id_condominio` diferente → `morador_removido`. `visita` → carrega `Visitas` por `id_visita` quando `pessoasMigrationEnabled`, senão `Visitantes` por `id_visitante`; ausente, de outro condomínio ou com `codigo_acesso` nulo → `visita_encerrada`.
9. Grava `Credenciais_Leituras (id_credencial, id_device, contador)`. Violação de unicidade (`P2002`) → `reuso`. Qualquer outro erro sobe.
10. Uma em cada ~200 gravações bem-sucedidas apaga, sem aguardar e sem propagar erro, as linhas de `Credenciais_Leituras` com `lido_em` anterior a 10 minutos.

- [ ] **Step 1: Escrever os testes que falham**, com `PrismaService` simulado no estilo dos specs vizinhos de `apps/api/src/app/facial`. Um teste por motivo da lista acima, mais:

```ts
it('morador válido devolve o morador e grava a leitura', async () => { /* ok:true, alvo.tipo 'morador', create chamado com {id_credencial, id_device, contador} */ });
it('visita válida devolve o PIN da visita, pela tabela certa conforme a flag', async () => { /* com flag ligada consulta visitas; desligada, visitantes */ });
it('aceita contador vizinho (−1 e +1) e nega ±2 como expirado (Review Focus 3)', async () => {});
it('segunda leitura do mesmo código no mesmo leitor é reuso, sem lançar (Review Focus 2)', async () => { /* create rejeita com {code:'P2002'} → {ok:false, motivo:'reuso'} */ });
it('o mesmo código em outro leitor é aceito', async () => {});
it('credencial de outro condomínio é "desconhecida" (Review Focus 4)', async () => {});
it('nenhum resultado, nem o rótulo, contém o código lido ou o segredo', async () => {});
```

- [ ] **Step 2: Rodar e ver falhar.** `npx nx test api --testFile=credenciais/credenciais-validacao.service.spec.ts` → FAIL.
- [ ] **Step 3: Implementar o serviço e o módulo** conforme Interfaces e a ordem acima. `qrAppHabilitado` lê só `Condominios.qr_app_habilitado`.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** — `feat(credenciais): validação de leitura do código dinâmico`.

### Task 5: Ligar a validação ao `runWebhook`

**Files:**
- Modify: `click-cond-web/apps/api/src/app/facial/facial.module.ts` (importar `CredenciaisNucleoModule`)
- Modify: `click-cond-web/apps/api/src/app/facial/facial.service.ts` — construtor; `runWebhook` nas regiões de `qrCodeLido` (5068-5070), cooldown (5137-5152), resolução de QR (5154-5191), captura de cadastro e negado (5328-5387)
- Modify: `click-cond-web/apps/api/src/app/facial/access-state.service.ts:52-54` (log do debounce)
- Test: `click-cond-web/apps/api/src/app/facial/webhook-credencial-dinamica.spec.ts`

**Interfaces:**
- Consumes: `CredenciaisValidacaoService.validarLeitura`, `.qrAppHabilitado`, `TEXTO_NEGACAO`, `ehCodigoDinamico`, `rotuloDeCredencial`.
- Produces: comportamento de `runWebhook` descrito abaixo. Nenhuma assinatura pública muda.

Comportamento a implementar, nesta ordem dentro de `runWebhook`:

1. Logo depois de calcular `qrCodeLido`: `const leituraDinamica = ehCodigoDinamico(qrCodeLido)`.
2. A chave do cooldown e os dois logs (o `Webhook ignorado por cooldown` e o `Debounce:` do `access-state.service`) usam `rotuloDeCredencial(valor)` + `:` + o próprio valor **somente em memória**: a chave passada a `shouldDebounce` continua sendo o valor lido (cada código é diferente, então o cooldown não bloqueia o código seguinte), mas o texto do log imprime `rotuloDeCredencial(...)`.
3. Se `leituraDinamica`: chama `validarLeitura(qrCodeLido, device, isBacklog ? timestamp : new Date())`.
   - `ok: false` → `registrarEvento(device, { face_id: rotulo, tipo_pessoa: 'desconhecido', id_pessoa: null, nome_pessoa: TEXTO_NEGACAO[motivo], evento: 'negado', confianca, timestamp })` e `throw new BadRequestException('Acesso negado: ' + TEXTO_NEGACAO[motivo])`. Não passa pela captura de cadastro (`enrollSessions.consumeForDevice`).
   - `ok: true`, alvo `morador` → preenche `tipoPessoa` (`funcionario` quando `morador.tipo` em minúsculas é `funcionario`, senão `morador`), `idPessoa`, `nomePessoa`, e `faceIdSalvo = rotulo`.
   - `ok: true`, alvo `visita` → segue pelo ramo existente de `resolverVisitantePorCredencial` com `codigo_acesso: alvo.codigoAcesso`, e `faceIdSalvo = rotulo`. `credencialWhereParaVisita` recebe esse mesmo `where`, como hoje.
4. Se **não** é leitura dinâmica e `qrCodeLido` existe: a busca em `Moradores.qrcode_acesso` continua igual. O ramo seguinte, que resolve `codigo_acesso` de visita, só roda quando `qrAppHabilitado(device.id_condominio)` é falso. Com a opção ligada, o PIN lido como QR cai no negado comum ("Não identificado ou expirado").
5. No bloco de negado comum e no log `Enrollment capture`, todo lugar que hoje interpola `qrCodeLido` passa por `rotuloDeCredencial`.
6. Limite de tentativas por leitor, em memória no `FacialService` (mapa `idDevice → instantes das negações`): a partir da 11ª negação de código dinâmico no mesmo leitor dentro de 60 s, as leituras dinâmicas seguintes daquele leitor são negadas **sem** chamar `validarLeitura`, até a janela de 60 s esvaziar. Ao entrar no bloqueio grava um único evento `negado` com `nome_pessoa` `Leitor bloqueado por excesso de QR inválido (1 min)`; as demais leituras bloqueadas não gravam evento. Leitura válida não zera a contagem.

- [ ] **Step 1: Escrever os testes que falham.** Montar o `FacialService` como fazem `leitor-sem-direcao.spec.ts` e `webhook-payload-nao-reconhecido.spec.ts` (mesmo arquivo de apoio/fábrica que eles usam), com `CredenciaisValidacaoService` simulado. Casos:

```ts
it('código P1 válido de morador registra entrada com face_id "cred:<id>" e aciona a ponte do leitor');
it('código P1 válido de visita resolve pela visita do PIN devolvido e respeita a janela existente');
it('código P1 negado grava "negado" com o texto do motivo e face_id sem o código');
it('código P1 negado não é consumido por sessão de cadastro de QR');
it('PIN lido como QR é negado quando qr_app_habilitado está ligado');
it('PIN lido como QR continua abrindo quando qr_app_habilitado está desligado');
it('Moradores.qrcode_acesso estático continua abrindo com a opção ligada');
it('evento de backlog valida contra o timestamp do evento, não contra agora');
it('11ª negação em 60 s bloqueia o leitor: validarLeitura deixa de ser chamado e só um evento de bloqueio é gravado');
it('passados 60 s o leitor volta a validar');
it('nenhuma chamada de logger nem de registrarEvento recebe o código lido');
```

- [ ] **Step 2: Rodar e ver falhar.** `npx nx test api --testFile=facial/webhook-credencial-dinamica.spec.ts` → FAIL.
- [ ] **Step 3: Implementar** os cinco pontos acima.
- [ ] **Step 4: Rodar e ver passar**, e rodar a pasta inteira para pegar regressão: `npx nx test api --testPathPattern=apps/api/src/app/facial` → PASS.
- [ ] **Step 5: Commit** — `feat(facial): leitor aceita código dinâmico e recusa PIN como QR com a opção ligada`.

### Task 6: Emissão, link do visitante e rotas

**Files:**
- Create: `click-cond-web/apps/api/src/app/credenciais/credenciais.service.ts`
- Create: `click-cond-web/apps/api/src/app/credenciais/credenciais.controller.ts`
- Create: `click-cond-web/apps/api/src/app/credenciais/credenciais.module.ts`
- Modify: `click-cond-web/apps/api/src/app/app.module.ts` (registrar `CredenciaisModule` junto de `ConvitesModule`)
- Modify: `click-cond-web/apps/api/src/app/visitantes/visitantes.service.ts` (método público novo; os `assertPodeAcessarVisitante`/`assertPodeAcessarVisita` existentes ficam privados)
- Test: `click-cond-web/apps/api/src/app/credenciais/credenciais.spec.ts`

**Interfaces:**
- Consumes: Tarefas 2, 3 e 4; `encryptSecret`/`decryptSecret`; `UsuarioAppGuard`, `idUsuarioApp` (`auth/usuario-app.guard`); `TenantAccessService.assertCondominio`; `assertSindico` (`auth/tenant.util`); `Public`, `SkipAudit`, `Throttle`; a base de URL do convite (`CONVITE_BASE_URL`, padrão `https://www.prestarecondominios.com.br`, como em `convites.service.ts:269-270`).
- Produces:
  - Em `VisitantesService`: `referenciaParaCredencial(id: number, payload?: JwtPayload): Promise<{ espaco: 'visita' | 'visitante'; id: number; id_condominio: number; nome: string; codigo_acesso: string | null; data_hora_inicio: Date | null; data_hora_termino: Date | null; bloco: string | null; apto: string | null }>` — usa `assertPodeAcessarVisita` com a flag ligada e `assertPodeAcessarVisitante` desligada.
  - Rotas (prefixo global `/api`):

| Rota | Guarda | Corpo | Resposta 200 |
|---|---|---|---|
| `POST credenciais/minha` | `UsuarioAppGuard` | `{ id_condominio: number, renovar?: boolean }` | `{ disponivel: true, id: number, segredo?: string, intervalo_s: 30, agora_servidor: string }` ou `{ disponivel: false, motivo: 'opcao_desligada' \| 'sem_morador' }` |
| `POST credenciais/visita/:id/link` | `UsuarioAppGuard` | — | `{ url: string, valido_ate: string \| null }` |
| `POST credenciais/visita/:id/invalidar-link` | `UsuarioAppGuard` | — | `{ ok: true }` |
| `GET credenciais/condominio/:idCondominio/opcao` | JWT global | — | `{ qr_app_habilitado: boolean }` |
| `PATCH credenciais/condominio/:idCondominio/opcao` | JWT global + `assertSindico` | `{ qr_app_habilitado: boolean }` | `{ qr_app_habilitado: boolean }` |
| `GET passes/publico/:token` | `@Public` `@SkipAudit` `@Throttle({ medium: { limit: 30, ttl: 60_000 } })` | — | `{ nome: string, condominio: string, unidade: string, valido_de: string \| null, valido_ate: string \| null, codigo: string, troca_em_s: number }` |

Regras:

- **`credenciais/minha`.** Confere `assertCondominio`. Linha de morador = primeira linha de `Moradores` com `id_user` do token e `id_condominio` pedido, por `id` crescente; não havendo → `sem_morador`. Opção desligada → `opcao_desligada`. Sem credencial ativa (`origem 'app'`, `revogada_em` nulo), ou com `renovar: true`: revoga a ativa, cria outra com segredo de 32 bytes aleatórios e devolve o `segredo` em hex. Com credencial ativa e sem `renovar`: devolve `id` e `agora_servidor`, **sem** `segredo`. `agora_servidor` é sempre o instante da resposta, em ISO.
- **Link do visitante.** `referenciaParaCredencial` decide quem pode. `codigo_acesso` nulo → 400 "Esta visita já foi encerrada." Reaproveita a credencial ativa `origem 'link'` da visita ou cria uma. Token = `<id em base36>.<base64url de HMAC-SHA256(chave, "passe-link|" + id + "|" + versao_link)>`, com `chave = sha256(FACIAL_CRED_KEY || JWT_SECRET)`. URL = `<base>/passe/<token>`. `valido_ate` = `data_hora_termino` da visita.
- **Invalidar link.** Incrementa `versao_link`.
- **Leitura pública.** Token malformado, credencial inexistente, revogada, `versao_link` diferente, opção do condomínio desligada, ou visita com `codigo_acesso` nulo: todos respondem o mesmo `404` com a mensagem "Passe indisponível." `codigo` = `gerarCodigo('P1', id, contadorDe(agora), segredo)`; `troca_em_s` = segundos até o próximo múltiplo de 30. `nome` é só o primeiro nome do visitante; `unidade` é bloco e apartamento; nenhum dado de morador.

- [ ] **Step 1: Escrever os testes que falham**, no estilo de `convites/convites.spec.ts`:

```ts
describe('credenciais/minha', () => {
  it('primeira chamada cria a credencial e devolve o segredo em hex de 64 caracteres');
  it('segunda chamada sem renovar devolve o mesmo id e nenhum segredo');
  it('renovar revoga a anterior e devolve id e segredo novos');
  it('usuário com morador em dois condomínios recebe a do condomínio pedido (Review Focus 4)');
  it('usuário sem linha de morador naquele condomínio recebe disponivel:false, motivo sem_morador');
  it('opção desligada devolve disponivel:false, motivo opcao_desligada');
  it('condomínio de outro tenant é barrado pelo assertCondominio');
  it('o segredo gravado no banco não é o hex devolvido (passou por encryptSecret)');
});
describe('link do visitante', () => {
  it('devolve url terminando em /passe/<token> e reaproveita a credencial numa segunda chamada');
  it('quem não pode acessar a visita recebe o erro do VisitantesService');
  it('visita com PIN anulado recusa com 400');
  it('invalidar troca o token: o link antigo passa a responder 404');
});
describe('passes/publico', () => {
  it('devolve um código que validarLeitura aceita no mesmo instante');
  it('token malformado, de outra versão e de credencial revogada respondem o mesmo 404');
  it('a resposta não contém segredo, PIN, sobrenome nem dado de morador');
});
describe('opção do condomínio', () => {
  it('PATCH exige síndico; morador recebe 403');
  it('GET devolve o valor atual');
});
```

- [ ] **Step 2: Rodar e ver falhar.** `npx nx test api --testFile=credenciais/credenciais.spec.ts` → FAIL.
- [ ] **Step 3: Implementar** serviço, controller (duas classes no mesmo arquivo: `CredenciaisController` em `credenciais` e `PassesPublicosController` em `passes`), módulo (`imports: [VisitantesModule, CredenciaisNucleoModule]`) e o método em `VisitantesService`. Registrar em `app.module.ts`.
- [ ] **Step 4: Rodar e ver passar**; depois `npx nx typecheck api` → sem erros.
- [ ] **Step 5: Commit** — `feat(credenciais): emissão, link do visitante e rotas`.

### Task 7: Abertura interna decidida pela nuvem

Fica fora do bloco condicional da bancada porque o projeto 2 (entregador) usa o mesmo método, com ou sem leitor embutido.

**Files:**
- Modify: `click-cond-web/apps/api/src/app/facial/facial.service.ts` (método novo, junto de `triggerDevice`, linha 1818)
- Test: `click-cond-web/apps/api/src/app/facial/abrir-dispositivo-interno.spec.ts`

**Interfaces:**
- Consumes: `this.client.triggerRelay(this.toConfig(device))` e `this.registrarEvento(device, {...})`, usados do mesmo jeito que a ponte leitor → abertura (`facial.service.ts:6407-6420`). `triggerRelay` não olha o tipo do aparelho; a recusa ao tipo `facial` existe só na rota manual `triggerDevice`.
- Produces (assinatura fixada, compartilhada com o projeto 2 — não alterar):

```ts
abrirDispositivoInterno(
  idDevice: number,
  ctx: {
    origem: 'credencial_qr' | 'delivery_portao';
    tipoPessoa: string;
    idPessoa?: number | null;
    nomePessoa: string;
    credencial?: string | null;
  },
): Promise<{ ok: boolean; erro?: string }>
```

  Método **público** de `FacialService` (o `FacialModule` já exporta o serviço; conferir e, se não exportar, exportar).

Regras:

- Carrega o aparelho por `id` com `ativo: 1`. Não existe ou está inativo → `{ ok: false, erro: 'dispositivo_indisponivel' }`, sem acionar e sem gravar evento.
- Aciona com `triggerRelay`, qualquer que seja o tipo do aparelho (`botoeira`, `catraca` ou `facial`).
- Abriu → grava `acionado_auto`; não abriu → grava `falha_acionamento` e devolve `{ ok: false, erro }` com o erro ou o status devolvido pelo acionamento. Exceção do acionamento vira `{ ok: false, erro }`, nunca sobe.
- Evento gravado: `face_id` = `ctx.credencial` quando informado, senão `ctx.origem`; `tipo_pessoa` = `ctx.tipoPessoa`; `id_pessoa` = `ctx.idPessoa ?? null`; `nome_pessoa` = `ctx.nomePessoa` quando abre, `<nomePessoa> (FALHA ao acionar <nome do aparelho>)` quando falha.
- `ctx.credencial` é um rótulo (ex.: `cred:<id>`), nunca o código lido. O método não valida isso; quem chama é responsável.
- Não confere regras de acesso, caminhos nem sentido: quem chama já decidiu. Não é exposto em controller algum.

- [ ] **Step 1: Escrever os testes que falham**, montando o `FacialService` como em `leitor-sem-direcao.spec.ts`:

```ts
it('aciona botoeira, catraca e terminal facial, e grava acionado_auto com face_id = credencial');
it('sem credencial, face_id é a origem');
it('acionamento que devolve ok:false grava falha_acionamento e devolve { ok:false, erro }');
it('acionamento que lança não propaga: devolve { ok:false, erro } e grava falha_acionamento');
it('aparelho inexistente ou inativo devolve dispositivo_indisponivel sem acionar nem gravar');
it('triggerDevice (rota manual) continua recusando aparelho do tipo facial');
```

- [ ] **Step 2: Rodar e ver falhar.** `npx nx test api --testFile=facial/abrir-dispositivo-interno.spec.ts` → FAIL.
- [ ] **Step 3: Implementar** o método conforme Interfaces e Regras.
- [ ] **Step 4: Rodar e ver passar**; `npx nx typecheck api` → sem erros.
- [ ] **Step 5: Commit** — `feat(facial): abertura interna de dispositivo decidida pela nuvem`.

---

## Bloco B — Portaria-web

### Task 8: Página pública do passe

**Files:**
- Modify: `click-cond-web/package.json` (dependência `qrcode-generator`, versão estável atual, instalada com `npm install qrcode-generator` em `click-cond-web`)
- Create: `click-cond-web/apps/portaria-web/src/app/passe/passe-page.component.ts`
- Modify: `click-cond-web/apps/portaria-web/src/app/app.routes.ts` (rota pública `passe/:token`, ao lado de `convite/:token`, linha 61)
- Test: `click-cond-web/apps/portaria-web/src/app/passe/passe-page.component.spec.ts`

**Interfaces:**
- Consumes: `GET {API_BASE}/passes/publico/:token` com a resposta da Tarefa 6; `API_BASE` e `ThemeService` como em `convite-page.component.ts`.
- Produces: componente standalone `PassePageComponent`, seletor `app-passe-page`.

Comportamento:

- Mostra a marca (mesmo cabeçalho do convite), o primeiro nome, condomínio e unidade, a validade, e o QR desenhado no próprio navegador com `qrcode-generator` (nível de correção `M`, fundo branco com margem, largura mínima de 240 px, mesmo no tema escuro).
- Contagem regressiva a partir de `troca_em_s`. Ao chegar a zero, ou a cada 25 s, o que vier primeiro, busca de novo.
- No evento `visibilitychange` para `visible`, busca na hora.
- Falha de rede: mantém o último QR por no máximo 30 s desde que foi recebido, com o aviso "Sem conexão. Tentando de novo…"; passado isso, esconde o QR.
- Resposta 404: tela "Passe indisponível", igual para todos os casos, e para de buscar.
- Nada é enviado a serviço de terceiro.

- [ ] **Step 1: Escrever os testes que falham**, no estilo de `convite/convite-page.component.spec.ts` (`HttpTestingController`, `fakeAsync`):

```ts
it('desenha o QR com o código recebido e mostra nome, condomínio e unidade');
it('busca de novo quando a contagem chega a zero');
it('busca imediatamente ao voltar ao primeiro plano (Review Focus 5)');
it('404 mostra "Passe indisponível" e não busca mais');
it('sem rede, esconde o QR depois de 30 s do último código');
it('não faz requisição para nenhum host além de API_BASE');
```

- [ ] **Step 2: Rodar e ver falhar.** `npx nx test portaria-web --testFile=passe/passe-page.component.spec.ts` → FAIL.
- [ ] **Step 3: Implementar** componente e rota.
- [ ] **Step 4: Rodar e ver passar**; depois `npx nx build portaria-web` → build concluído.
- [ ] **Step 5: Commit** — `feat(portaria-web): página pública do passe do visitante`.

### Task 9: Liga e desliga "QR no app" para o síndico

**Files:**
- Modify: `click-cond-web/apps/portaria-web/src/app/configuracoes/configuracoes-page.component.ts`
- Modify: `click-cond-web/apps/portaria-web/src/app/configuracoes/configuracoes-page.component.html`
- Test: `click-cond-web/apps/portaria-web/src/app/configuracoes/configuracoes-page.qr-app.spec.ts`

**Interfaces:**
- Consumes: `GET` e `PATCH {API_BASE}/credenciais/condominio/:idCondominio/opcao` (Tarefa 6); o condomínio ativo e o papel do usuário como a página já os obtém.
- Produces: seção "QR no app" na página de configurações.

Texto exato do aviso, mostrado antes de confirmar a ligação: **"O QR depende da internet do condomínio. Antes de ligar, confirme que todo morador sem rosto cadastrado tem tag ou que há porteiro. Com a opção ligada, o PIN do visitante deixa de abrir quando mostrado como QR no leitor; continua valendo digitado na portaria."**

- [ ] **Step 1: Escrever os testes que falham** (estilo de `configuracoes-page.perfil.spec.ts`): a seção só aparece para síndico; ligar pede confirmação com o texto acima e só então envia `PATCH { qr_app_habilitado: true }`; desligar envia `false` sem confirmação; erro do servidor volta o controle ao estado anterior.
- [ ] **Step 2: Rodar e ver falhar.** `npx nx test portaria-web --testFile=configuracoes/configuracoes-page.qr-app.spec.ts` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar**; `npx nx build portaria-web` → build concluído.
- [ ] **Step 5: Commit** — `feat(portaria-web): síndico liga e desliga o QR no app`.

---

## Bloco C — App Flutter

(Comandos em `click-cond-app/click-cond-app`.)

### Task 10: Formato do código em Dart

**Files:**
- Modify: `click-cond-app/click-cond-app/pubspec.yaml` (dependência `crypto`, via `flutter pub add crypto`)
- Create: `click-cond-app/click-cond-app/lib/utils/codigo_dinamico.dart`
- Test: `click-cond-app/click-cond-app/test/codigo_dinamico_test.dart`

**Interfaces:**
- Produces:
  - `String gerarCodigoDinamico({required int id, required int contador, required List<int> segredo})` — sempre prefixo `P1`
  - `int contadorDe(DateTime instante)` — `instante.millisecondsSinceEpoch ~/ 30000`
  - `int segundosAteTrocar(DateTime instante)` — de 1 a 30
  - `List<int> segredoDeHex(String hex)`

- [ ] **Step 1: Escrever os testes que falham**, com os cinco vetores da tabela "Vetores de teste do formato" (mesmos ids, contadores, segredos e códigos), mais `contadorDe(DateTime.fromMillisecondsSinceEpoch(1794614400000, isUtc: true)) == 59820480` e `segundosAteTrocar` nos instantes `…:00` → 30, `…:29` → 1, `…:30` → 30.
- [ ] **Step 2: Rodar e ver falhar.** `flutter test test/codigo_dinamico_test.dart` → FAIL.
- [ ] **Step 3: Implementar** com `package:crypto` (`Hmac(sha256, segredo)`), mesma montagem e mesmo base32 da Tarefa 3. O id acima de 2³¹ tem de funcionar (o quarto vetor cobre).
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** — `feat(app): formato do código dinâmico`.

### Task 11: Chamadas à API e guarda do segredo

**Files:**
- Create: `click-cond-app/click-cond-app/lib/controllers/controller_credencial.dart`
- Create: `click-cond-app/click-cond-app/lib/services/credencial_acesso.dart`
- Test: `click-cond-app/click-cond-app/test/credencial_acesso_test.dart`

**Interfaces:**
- Consumes: `ApiClient`, `ApiConfig.buildUri` (como em `controller_visitantes.dart`); `SecureStorageInterface`/`DefaultSecureStorage` de `services/biometric_auth_service.dart` (o mesmo que `SegredosSessao` usa); Tarefa 10.
- Produces:
  - `controller_credencial.dart`: `Future<Map<String, dynamic>> apiCredencialMinha(int idCondominio, {bool renovar = false})`; `Future<Map<String, dynamic>> apiLinkPasseVisita(int idVisita)`; `Future<Map<String, dynamic>> apiInvalidarLinkPasse(int idVisita)`. Em erro devolvem `{ "erro": <mensagem> }`, como as vizinhas.
  - `credencial_acesso.dart`:
    - `enum SituacaoCredencial { pronta, indisponivelNoCondominio, semMorador, semInternetNaPrimeiraVez, erro }`
    - `class CredencialLocal { final int id; final List<int> segredo; final int deltaMs; }`
    - `class CredencialAcesso { static SecureStorageInterface armazenamento; static Future<Map<String, dynamic>> Function(int, {bool renovar}) chamar; static DateTime Function() agora; static Future<({SituacaoCredencial situacao, CredencialLocal? credencial})> preparar(int idCondominio); static String codigoAtual(CredencialLocal c); static int segundosAteTrocar(CredencialLocal c); static Future<void> esquecer(int idCondominio); }`
  - Chave no armazenamento seguro: `cred_acesso_<idCondominio>`, valor JSON `{ "id": int, "segredo": hex, "delta_ms": int }`.

Regras de `preparar`:

- Sem credencial guardada: chama a API com `renovar: true`. Sucesso → guarda e devolve `pronta`. Sem rede → `semInternetNaPrimeiraVez`.
- Com credencial guardada: devolve `pronta` na hora, a partir do que está guardado, e em segundo plano chama a API sem `renovar`. Se a resposta trouxer `id` diferente do guardado (a credencial foi trocada por outro aparelho), chama de novo com `renovar: true` e substitui. Em toda resposta com `agora_servidor`, recalcula `delta_ms = agora_servidor − relógio do aparelho` e regrava.
- `disponivel: false` → apaga o guardado e devolve `indisponivelNoCondominio` ou `semMorador`.
- `codigoAtual` usa `agora() + delta_ms`.
- No logout, `esquecer` é chamado para o condomínio ativo (ligar no mesmo ponto em que `SegredosSessao` é limpo).

- [ ] **Step 1: Escrever os testes que falham**, com armazenamento e `chamar` falsos:

```dart
test('primeira vez com rede: pede renovar, guarda e devolve pronta');
test('primeira vez sem rede: semInternetNaPrimeiraVez e nada guardado');
test('com credencial guardada e sem rede: pronta, gera código offline');
test('relógio do aparelho 5 minutos adiantado: codigoAtual usa a hora corrigida (Review Focus 3)');
test('servidor devolve outro id: renova e substitui a guardada');
test('servidor devolve disponivel false: apaga a guardada');
test('esquecer apaga a chave do condomínio e só ela');
```

- [ ] **Step 2: Rodar e ver falhar.** `flutter test test/credencial_acesso_test.dart` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** — `feat(app): credencial de acesso guardada no aparelho`.

### Task 12: Tela "Meu acesso"

**Files:**
- Modify: `click-cond-app/click-cond-app/pubspec.yaml` (dependência `screen_brightness`, via `flutter pub add screen_brightness`)
- Create: `click-cond-app/click-cond-app/lib/pages/shared/meu_acesso/meu_acesso_page.dart`
- Create: `click-cond-app/click-cond-app/lib/services/tela_segura.dart`
- Modify: `click-cond-app/click-cond-app/android/app/src/main/kotlin/br/com/clickprestare/app/MainActivity.kt`
- Modify: `click-cond-app/click-cond-app/lib/pages/shared/my_condominium.dart` (lista de `_MenuItem`, linha ~184, logo depois do item de visitantes)
- Test: `click-cond-app/click-cond-app/test/meu_acesso_page_test.dart`

**Interfaces:**
- Consumes: `CredencialAcesso` (Tarefa 11); `QrImageView` de `qr_flutter`; `id_condominio` do singleton (`lib/pages/singleton.dart`); tema e widgets Prestare Dark já usados nas telas vizinhas (`lib/theme`, `lib/widgets`).
- Produces:
  - `class MeuAcessoPage extends StatefulWidget`
  - `class TelaSegura { static Future<void> ligar(); static Future<void> desligar(); }` — canal `MethodChannel('prestare/tela_segura')`, métodos `ligar` e `desligar`; no Android aplica e remove `WindowManager.LayoutParams.FLAG_SECURE`; em outras plataformas não faz nada e não lança.
  - Item de menu `'Meu acesso'`, ícone `PhosphorIcons.qrCode`, visível só para o perfil morador.

Comportamento da tela:

- `pronta`: QR em fundo branco com margem, largura de 260, o nome do condomínio, e "Novo código em N s". O QR e o contador são redesenhados por um `Timer` de 1 s; o código só muda quando o contador de 30 s vira.
- Enquanto visível: brilho no máximo e `TelaSegura.ligar()`. Ao sair, ou quando o app vai para segundo plano: brilho restaurado e `TelaSegura.desligar()`.
- `semInternetNaPrimeiraVez`: "Conecte-se à internet uma vez para ativar seu QR de acesso." com botão "Tentar de novo".
- `indisponivelNoCondominio`: "O QR de acesso não está ativo neste condomínio."
- `semMorador`: "Seu usuário não tem unidade vinculada neste condomínio."
- O item de menu aparece sempre para o morador; a tela é que explica quando não está disponível (assim o app não precisa de uma chamada a mais ao abrir o menu).

- [ ] **Step 1: Escrever os testes de widget que falham**, com `CredencialAcesso.chamar`, `.armazenamento` e `.agora` falsos:

```dart
testWidgets('pronta: mostra um QrImageView com o código do instante e o contador');
testWidgets('o código muda quando o relógio cruza o múltiplo de 30 s');
testWidgets('primeira vez sem internet: mostra a mensagem e o botão Tentar de novo');
testWidgets('indisponível no condomínio e sem unidade: mostram as mensagens exatas');
testWidgets('ao sair da tela desliga a tela segura');
```

- [ ] **Step 2: Rodar e ver falhar.** `flutter test test/meu_acesso_page_test.dart` → FAIL.
- [ ] **Step 3: Implementar** a tela, `TelaSegura`, o canal no `MainActivity.kt` e o item de menu.
- [ ] **Step 4: Rodar e ver passar**; `flutter analyze --no-fatal-infos --no-fatal-warnings` → sem erros.
- [ ] **Step 5: Commit** — `feat(app): tela Meu acesso com QR dinâmico`.

### Task 13: Visitantes e prestadores compartilham o passe

**Files:**
- Modify: `click-cond-app/click-cond-app/lib/pages/shared/visitantes/list_visitantes.dart` (QR estático nas linhas ~609-718; envio por WhatsApp nas linhas ~1021-1070)
- Modify: `click-cond-app/click-cond-app/lib/pages/shared/prestador de servico/list_prestadores.dart` (QR estático nas linhas ~273-351)
- Modify: `click-cond-app/click-cond-app/lib/utils/access_invite_message.dart`
- Test: `click-cond-app/click-cond-app/test/convite_visitante_mensagem_test.dart` (existente, atualizar) e `click-cond-app/click-cond-app/test/compartilhar_passe_test.dart`

**Interfaces:**
- Consumes: `apiLinkPasseVisita`, `apiInvalidarLinkPasse` (Tarefa 11).
- Produces:
  - `buildVisitorAccessInvite(...)`: o parâmetro `qrCodeUrl` passa a se chamar `passeUrl`. Com `passeUrl`, o trecho final vira exatamente:

```
📲 *Passe de acesso (QR):*
Abra o link ao chegar e mostre o QR no leitor:
<passeUrl>

Se preferir, informe o PIN na portaria.
```

  Sem `passeUrl`, a última linha é `Informe este código ao chegar na portaria para liberação da sua entrada.`

Comportamento:

- Nas duas listas, o `QrImageView` do PIN some. No lugar: o PIN em texto (como já aparece) e o botão "Compartilhar passe".
- "Compartilhar passe" chama `apiLinkPasseVisita(id)`. Sucesso → monta a mensagem com `passeUrl` e abre o WhatsApp pelo caminho que a tela já usa. Erro (inclusive `opcao_desligada` vinda do servidor) → envia a mensagem sem link, só com o PIN, sem travar o usuário.
- Ação secundária "Cancelar link", com confirmação "O link enviado deixa de funcionar. Continuar?", chama `apiInvalidarLinkPasse(id)`.
- Nenhuma referência a `api.qrserver.com` permanece no app.

- [ ] **Step 1: Atualizar e escrever os testes que falham:** a mensagem com `passeUrl` contém o link e o texto exato acima e não contém `qrserver`; sem `passeUrl` não menciona QR; nas duas listas não existe mais `QrImageView` alimentado por `codigo_acesso`; erro da API ainda compartilha o PIN.
- [ ] **Step 2: Rodar e ver falhar.** `flutter test test/convite_visitante_mensagem_test.dart test/compartilhar_passe_test.dart` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar**; confirmar com `grep -rn "qrserver" lib` → nenhuma ocorrência; `flutter analyze --no-fatal-infos --no-fatal-warnings` → sem erros.
- [ ] **Step 5: Commit** — `feat(app): visitante e prestador recebem link do passe em vez do QR do PIN`.

---

## Bloco D — Leitor embutido no terminal (só com a Tarefa 1 em `CONFIRMA` ou `PARCIAL`)

Com `NEGA` ou `SEM_APARELHO`, pule este bloco inteiro e vá para o Bloco E.

### Task 14: Agente encaminha a leitura de QR do terminal

**Files:**
- Modify: `click-cond-web/agent/src/drivers/dahua-facial.js` (`consumeDahuaEvents`, linhas 680-712)
- Modify: `click-cond-web/agent/src/index.js` (`forwardAccessEvent`, linhas 965-1012)
- Test: `click-cond-web/agent/test/drivers-dahua-facial.test.js` e `click-cond-web/agent/test/core-liveview-acesso.test.js` (existentes, acrescentar casos)

**Interfaces:**
- Consumes: o `Code`, o `Method` e o nome do campo registrados em `docs/operacao/2026-11-bancada-qr-terminal.md`.
- Produces: corpo enviado a `POST /api/facial/agent/condo/:token/event` para leitura de QR: `{ deviceId, qrcode: <conteúdo bruto>, event: 'recognized', timestamp }`, sem `external_id` e sem `person_id`.

Regras:

- `consumeDahuaEvents` passa a entregar também o evento de acesso identificado na bancada, além de `_DoorFace_`. O corte de buffer no fim da função precisa considerar os dois códigos.
- Em `forwardAccessEvent`: quando o campo de conteúdo, depois de `trim` e maiúsculas, casa com `^P[12][A-Z2-7]{26}$`, o evento é encaminhado como QR **mesmo com `ErrorCode≠0`** e mesmo sem `UserID`. Qualquer outro evento sem `UserID`, com `FFFFFF` ou com `ErrorCode≠0` continua descartado como hoje.
- O debounce de origem para QR usa a chave `device.id + ':' + conteúdo` (cada código é novo, então só colapsa a rajada do mesmo código).
- O log do agente nunca imprime o conteúdo: usa `QR dinâmico` no lugar.
- Evento de QR não entra na fila offline (um código de 30 s não tem valor depois) e não vem no replay de log.

- [ ] **Step 1: Escrever os testes que falham:** o trecho bruto registrado na bancada vira uma chamada com `qrcode`; evento de QR com `ErrorCode` diferente de zero é encaminhado; evento de rosto negado continua descartado; cartão comum (conteúdo que não casa com o padrão) continua descartado; nenhuma linha de log contém o código; com a nuvem fora, o evento de QR não é enfileirado.
- [ ] **Step 2: Rodar e ver falhar.** Em `click-cond-web/agent`: `npm test` → FAIL nos casos novos.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.** `npm test` → todos PASS.
- [ ] **Step 5: Commit** — `feat(agente): encaminha leitura de QR dinâmico do terminal`.

### Task 15: API aceita o evento de QR do agente e abre o próprio terminal

**Files:**
- Modify: `click-cond-web/apps/api/src/app/facial/facial.service.ts` — `processAgentEvent` (4712-4749) e a ponte leitor → abertura (6302-6321)
- Test: `click-cond-web/apps/api/src/app/facial/agente-qr-dinamico.spec.ts`

**Interfaces:**
- Consumes: `ehCodigoDinamico`; `abrirDispositivoInterno(idDevice, ctx)` da Tarefa 7.
- Produces: `processAgentEvent` aceita evento só com `qrcode` dinâmico; `runWebhook` abre o próprio terminal `facial` depois de validar. Nenhuma assinatura nova.

Regras:

- `processAgentEvent`: aceita evento cujo único identificador é `qrcode`, **somente** quando `ehCodigoDinamico(payload.qrcode)` e o aparelho é do tipo `facial`. Qualquer outro `qrcode` por este canal continua rejeitado com a mensagem atual.
- Em `runWebhook`, depois de identificar a pessoa: quando o aparelho é do tipo `facial`, a leitura foi dinâmica e validada, o evento é `entrada` (ou `saida` explícita) e não é backlog, chama `abrirDispositivoInterno(device.id, { origem: 'credencial_qr', tipoPessoa, idPessoa, nomePessoa, credencial: rotulo })`, isto é, com o **próprio** aparelho. Não passa por caminhos, regras nem pelo fallback "abre tudo".
- A rota manual `triggerDevice` (linha 1818) não muda: continua recusando o tipo `facial`.

- [ ] **Step 1: Escrever os testes que falham:** evento do agente só com `qrcode` dinâmico em aparelho `facial` é aceito e aciona aquele aparelho uma vez; `qrcode` que não é dinâmico é rejeitado; aparelho `lpr` com `qrcode` é rejeitado; código negado não aciona nada; backlog não aciona; `triggerDevice` em aparelho `facial` continua recusando; falha do acionamento grava `falha_acionamento`.
- [ ] **Step 2: Rodar e ver falhar.** `npx nx test api --testFile=facial/agente-qr-dinamico.spec.ts` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar**; `npx nx test api --testPathPattern=apps/api/src/app/facial` → PASS.
- [ ] **Step 5: Commit** — `feat(facial): terminal com leitor de QR abre por decisão da nuvem`.

---

## Bloco E — Fechamento

### Task 16: Guia de implantação e verificação completa

**Files:**
- Create: `docs/operacao/qr-no-app-implantacao.md`

**Interfaces:**
- Consumes: tudo o que veio antes; o resultado da Tarefa 1.

Conteúdo do guia, em linguagem para quem implanta:

1. Ordem de publicação: aplicar `prisma/manual_2026-11_credenciais_acesso.sql` no RDS e conferir que as duas tabelas e a coluna existem; só depois publicar a API e a portaria-web; por último o app nas lojas.
2. Só ligar "QR no app" num condomínio depois de o app novo estar disponível aos moradores (versões antigas ainda desenham o PIN como QR, que deixa de abrir).
3. Antes de ligar: todo morador sem rosto cadastrado precisa ter tag, ou o condomínio precisa ter porteiro.
4. Leitores aceitos: leitor de QR avulso cadastrado como `qrcode_reader`. Terminal Dahua/Intelbras com leitor embutido: conforme a bancada (copiar o veredito e, se couber, a versão mínima do agente).
5. Sem internet no condomínio o QR não abre; rosto e tag continuam.
6. Pendência registrada: o QR de login da portaria-web ainda usa `api.qrserver.com` (fora deste projeto).
7. O tempo medido da leitura até a abertura na bancada, quando houver bancada; senão, "não medido".

- [ ] **Step 1: Escrever o guia.**
- [ ] **Step 2: API.** Em `click-cond-web`: `npx nx typecheck api` → sem erros; `npx nx test api` → todos PASS; `npx nx build api` → concluído.
- [ ] **Step 3: Portaria-web.** `npx nx test portaria-web` → todos PASS; `npx nx build portaria-web` → concluído.
- [ ] **Step 4: Agente** (só se o Bloco D foi executado). Em `click-cond-web/agent`: `npm test` → todos PASS.
- [ ] **Step 5: App.** Em `click-cond-app/click-cond-app`: `flutter pub get`; `flutter analyze --no-fatal-infos --no-fatal-warnings` → sem erros; `flutter test` → todos PASS.
- [ ] **Step 6: Varredura de vazamento.** `grep -rn "qrserver" click-cond-app/click-cond-app/lib` → vazio. Nos arquivos novos e alterados da API, nenhum `logger.*` interpola `qrCodeLido`, `segredo` ou `token` sem passar por `rotuloDeCredencial`.
- [ ] **Step 7: Idempotência do SQL.** Ler `prisma/manual_2026-11_credenciais_acesso.sql` de ponta a ponta confirmando que cada instrução é segura numa segunda execução (não executar contra banco algum).
- [ ] **Step 8: Commit** — `docs(credenciais): guia de implantação do QR no app`.

---

## Decisões tomadas neste plano (onde o desenho deixava ao implementador)

- **Segredo cifrado no banco** com `encryptSecret` de `facial/device-secret.util.ts`, que já existe.
- **Nenhuma variável de ambiente nova**: a chave do link deriva de `FACIAL_CRED_KEY || JWT_SECRET`.
- **Revogação da credencial de visita acoplada ao PIN**: vale enquanto `codigo_acesso` da visita existir. Evita alterar os pontos que hoje anulam o PIN.
- **Limpeza de `Credenciais_Leituras`** feita de forma oportunista na própria validação (linhas com mais de 10 minutos), sem agendador.
- **Limite da rota pública**: 30 requisições por minuto.
- **Tentativas inválidas no leitor**: 10 negações de código dinâmico em 60 s bloqueiam as leituras dinâmicas daquele leitor até a janela esvaziar.
- **Reemissão**: o app só pede segredo novo (`renovar: true`) quando não tem um guardado; aparelho novo derruba o anterior, e o aparelho antigo percebe pela troca de `id`.
- **QR no navegador** com `qrcode-generator`; **brilho** com `screen_brightness`; **bloqueio de captura** por canal nativo próprio no `MainActivity.kt`, sem pacote.
- **"Meu acesso"** entra no menu de `my_condominium.dart`, depois de visitantes, só para morador.
- **Rota de opção do condomínio** (`credenciais/condominio/:id/opcao`) criada aqui, porque não havia rota para o síndico alterar um liga/desliga de `Condominios`.
- **Validação separada em `CredenciaisNucleoModule`**, porque `VisitantesModule` importa `FacialModule` e a validação precisa ser usada pelo `FacialModule`.
- **Evento de QR do agente não entra na fila offline.**
- **`abrirDispositivoInterno`** tem tarefa própria (Tarefa 7), fora do bloco da bancada, com a assinatura combinada com o projeto 2.
- **`origem`** da credencial é texto curto livre (`app`, `link`; o projeto 3 acrescenta `wallet_apple` e `wallet_google`).
