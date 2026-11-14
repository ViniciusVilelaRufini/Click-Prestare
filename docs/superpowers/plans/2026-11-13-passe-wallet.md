# Passe do morador na Apple Wallet e Google Wallet — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O morador adiciona à carteira do celular um passe com QR diário (`P2`) que os mesmos leitores do QR dinâmico aceitam, e que morador ou operador cancelam na hora.

**Architecture:** O passe é uma credencial própria em `Credenciais_Acesso` (`origem` `wallet_apple` ou `wallet_google`), validada no mesmo `CredenciaisValidacaoService` do projeto 1, com contador diário e sem anti-reuso. A API monta e assina o `.pkpass`, atende o serviço de atualização da Apple, avisa os aparelhos por APNs com o certificado do passe, e mantém o objeto do Google pela API REST. Uma tarefa diária na hora 0 de Brasília troca o código. Chaves de assinatura vêm do S3 privado; sem elas, a carteira responde "indisponível" e nada mais muda.

**Tech Stack:** NestJS 11 + Prisma 6 (MySQL) em `click-cond-web/apps/api`; Angular 21 em `click-cond-web/apps/portaria-web`; Flutter em `click-cond-app/click-cond-app`. Dependência nova na API: `node-forge` (assinatura PKCS#7). Já presentes e usados: `adm-zip`, `sharp`, `node:crypto`, `node:http2`, `fetch` global.

**Spec:** `docs/superpowers/specs/2026-11-13-passe-wallet-design.md`

**Depende de:** `docs/superpowers/plans/2026-11-13-qr-dinamico-credencial.md` concluído (Tarefas 2 a 7, 9, 11 e 12). Os nomes consumidos abaixo são os dos blocos Interfaces de lá. Antes de começar, conferir que existem no branch: `Credenciais_Acesso`, `codigo-dinamico.util.ts`, `CredenciaisValidacaoService`, `CredenciaisNucleoModule`, `credenciais.controller.ts`, `MeuAcessoPage`.

## Global Constraints

- Base: worktree `C:/w/acesso`, branch `feat/acesso-celular`. Caminhos relativos à raiz do worktree; `apps/…` é relativo a `click-cond-web/`.
- Produção é o NestJS. Não tocar no Express de dev.
- Schema: alterar `click-cond-web/prisma/schema.prisma` **e** criar SQL manual idempotente. Ninguém roda `prisma db push` nem `migrate` contra banco algum neste plano.
- **Nenhuma variável de ambiente nova** (o Elastic Beanstalk está no limite de 4096 caracteres). Certificado, chaves e configuração do Google vêm do S3 privado por `StorageService.lerObjetoTexto`. Chaves derivadas usam `sha256(FACIAL_CRED_KEY || JWT_SECRET)`, como no projeto 1.
- Nada de `pass.key`, certificado, chave do Google, segredo de credencial, `authenticationToken` ou token de push em log, em `Acessos_Facial`, em resposta de rota ou no repositório. Os testes usam chaves geradas na hora (`crypto.generateKeyPairSync`) e certificado autoassinado gerado com `node-forge`.
- Identificadores fixos: Pass Type ID `pass.br.com.prestarecondominios.acesso`; team `9FD7V97G5V`; organização `Prestare`.
- Chaves de objeto no S3 privado (as únicas que a API lê):
  - `config/wallet/apple/pass.key` — chave privada RSA do passe, PEM
  - `config/wallet/apple/pass.pem` — certificado do Pass Type ID, PEM
  - `config/wallet/apple/wwdr-g4.pem` — intermediário Apple WWDR G4, PEM
  - `config/wallet/google/service-account.json` — chave da conta de serviço, no formato que o Google entrega
  - `config/wallet/google/emissor.json` — `{ "issuer_id": "<número>" }`
- Formato do código: `P2` + 26 caracteres base32, mesma montagem do `P1`; contador = dias desde 01/01/1970 no fuso de Brasília = `floor((unix_ms − 3 h) / 86 400 000)`; aceitos o dia atual e o anterior.
- O código `P2` nunca grava em `Credenciais_Leituras`.
- Opção por condomínio `wallet_habilitado`, **desligada por padrão**, e só pode ser ligada com `qr_app_habilitado` ligada.
- Visual do passe e das telas: Prestare Dark. Passe: fundo `rgb(11,11,11)`, texto `rgb(255,255,255)`, rótulos `rgb(163,163,163)` (tokens `bg-100`, `ink`, `ink-muted` de `click-cond-app/.../lib/theme/app_colors.dart`). Sem foto, sem CPF.
- Todo `POST` chamado pelo app leva `@HttpCode(200)`. Rota pública: `@Public()` + `@Throttle(...)` + `@SkipAudit()`.
- O app não ganha entitlement novo e não consulta a carteira do aparelho.
- Textos ao usuário em português do Brasil.
- Cada tarefa termina com commit no branch `feat/acesso-celular`, mensagem em português (`feat(wallet): …`), com o rodapé `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`. Não fazer push.
- Onde este plano cita nome de campo ou cabeçalho da Apple (PassKit, serviço de atualização, APNs) ou do Google (Generic passes), o implementador confere na documentação oficial antes de escrever o código e, se houver diferença, vale a documentação; a diferença é anotada na mensagem do commit.

## Review Focus

1. **Aparelho que ficou dois dias sem internet e reconecta:** o passe mostra código de anteontem; a leitura é negada como vencida (não como inválida), e a entrega do passe pelo serviço da Apple traz o código do dia. Testes nas Tarefas 3 e 6.
2. **Morador com passe nas duas carteiras, ou em dois condomínios:** cancelar em um condomínio cancela Apple e Google daquele condomínio e não toca no outro; cancelar não derruba o QR do app. Testes nas Tarefas 4 e 9.
3. **Apple chamando o serviço com dados que não são nossos** (número de série inexistente, Pass Type ID de outro emissor, `passesUpdatedSince` que não é número, corpo sem `pushToken`): responde o código HTTP do protocolo (401, 404, 204), nunca 500, e a listagem não revela nada além de números de série. Teste na Tarefa 6.
4. **Chaves ausentes ou trocadas no S3 com a API no ar:** as rotas respondem "indisponível", a tarefa diária não lança, e a API volta a emitir sozinha até 5 minutos depois de os arquivos aparecerem, sem reinício. Testes nas Tarefas 4 e 8.
5. **Um aparelho com token de push morto no meio da lista:** a tarefa diária avisa os demais, apaga só o registro morto e termina com sucesso. Teste na Tarefa 8.

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `click-cond-web/prisma/schema.prisma` | `Wallet_Registros`; `Condominios.wallet_habilitado`; `Credenciais_Acesso.wallet_atualizado_em` |
| `click-cond-web/prisma/manual_2026-11_wallet.sql` | o mesmo, idempotente |
| `apps/api/src/app/credenciais/codigo-dinamico.util.ts` | acrescenta `diaBrasiliaDe` |
| `apps/api/src/app/credenciais/credenciais-validacao.service.ts` | ramo `P2` |
| `apps/api/src/app/wallet/wallet-chaves.service.ts` | lê e guarda em memória as chaves do S3 |
| `apps/api/src/app/wallet/apple-passe.builder.ts` | monta e assina o `.pkpass` (função pura) |
| `apps/api/src/app/wallet/apple-push.client.ts` | aviso de atualização por APNs com certificado |
| `apps/api/src/app/wallet/apple-servico.controller.ts` | as 5 rotas do serviço de atualização da Apple |
| `apps/api/src/app/wallet/google-wallet.client.ts` | classe, objeto, link assinado, atualização, inativação |
| `apps/api/src/app/wallet/wallet.service.ts` | emissão, situação, cancelamento, tarefa diária |
| `apps/api/src/app/wallet/wallet.controller.ts` | rotas `credenciais/wallet/*` |
| `apps/api/src/app/wallet/wallet.module.ts` | módulo; importa `CredenciaisNucleoModule` |
| `apps/api/src/assets/wallet/*.png` | ícone e logo do passe |
| `apps/portaria-web/src/app/moradores/…` | botão "Cancelar passe da carteira" |
| `apps/portaria-web/src/app/configuracoes/…` | liga/desliga "Passe na carteira" |
| `click-cond-app/.../lib/controllers/controller_wallet.dart` | chamadas à API |
| `click-cond-app/.../lib/pages/shared/meu_acesso/passe_carteira_secao.dart` | seção da carteira na tela "Meu acesso" |
| `docs/operacao/wallet-implantacao.md` | guia de operação |

## Vetores de teste do formato `P2` (iguais para todos os testes)

Segredo A (hex): `000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f`
Segredo B (hex): `ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100`

| id | contador (dia) | segredo | código |
|---|---|---|---|
| 1 | 0 | A | `P2AAAAAAIAAAAABE626COYMR6BFQ` |
| 1 | 20771 | A | `P2AAAAAAIAABISHDX2Z4VLLSGTIQ` |
| 1 | 20772 | A | `P2AAAAAAIAABISJQUPSUBO6ZWPJY` |
| 4294967295 | 20771 | A | `P2777777YAABISGBGZGOT5ZD67E4` |
| 123456 | 20800 | B | `P2AAA6EQAAABIUACOWLYZSIM4LWE` |

Dia de Brasília: `2026-11-14T02:59:59Z` → `20770`; `2026-11-14T03:00:00Z` → `20771`; `2026-11-15T02:59:59Z` → `20771`.

---

## Bloco A — Base

### Task 1: Schema e SQL manual

**Files:**
- Modify: `click-cond-web/prisma/schema.prisma`
- Create: `click-cond-web/prisma/manual_2026-11_wallet.sql`

**Interfaces:**
- Consumes: `Credenciais_Acesso` e `Condominios.qr_app_habilitado` (projeto 1, Tarefa 2).
- Produces:
  - `Condominios.wallet_habilitado: Boolean @default(false)`
  - `Credenciais_Acesso.wallet_atualizado_em: DateTime? @db.DateTime(0)` — instante da última mudança do passe (emissão, troca diária, cancelamento, opção do condomínio)
  - `Wallet_Registros { id Int @id @default(autoincrement()); id_credencial Int; device_id String @db.VarChar(100); push_token String @db.VarChar(200); criado_em DateTime @default(now()) @db.DateTime(0); atualizado_em DateTime @default(now()) @db.DateTime(0) }` com relação a `Credenciais_Acesso` (`onDelete: Cascade`, map `fk_walreg_cred`), `@@unique([device_id, id_credencial], map: "un_walreg")` e `@@index([id_credencial], map: "idx_walreg_cred")`.

- [ ] **Step 1: Editar o `schema.prisma`** com os três itens.
- [ ] **Step 2: Escrever o SQL manual** no padrão de `prisma/manual_2026-11_credenciais_acesso.sql`: `CREATE TABLE IF NOT EXISTS` para `Wallet_Registros`; as duas colunas novas com consulta a `information_schema.COLUMNS` + `PREPARE`. Tem de rodar duas vezes sem erro, e tem de falhar com mensagem clara se `Credenciais_Acesso` não existir (o SQL do projeto 1 vem antes).
- [ ] **Step 3: Validar.** Em `click-cond-web`: `npx prisma validate --schema=prisma/schema.prisma` → válido; `npx prisma generate --schema=prisma/schema.prisma` → sem erro; `npx nx typecheck api` → sem erros.
- [ ] **Step 4: Commit** — `feat(wallet): tabela de registros da carteira e opção por condomínio`.

### Task 2: Contador diário no formato

**Files:**
- Modify: `click-cond-web/apps/api/src/app/credenciais/codigo-dinamico.util.ts`
- Test: `click-cond-web/apps/api/src/app/credenciais/codigo-dinamico.p2.spec.ts`

**Interfaces:**
- Consumes: `gerarCodigo`, `decodificarCodigo`, `conferirMac` (já aceitam `'P2'`).
- Produces: `diaBrasiliaDe(instante: Date): number` — `Math.floor((instante.getTime() − 3 * 3600 * 1000) / 86_400_000)`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
it.each([
  [1, 0, A, 'P2AAAAAAIAAAAABE626COYMR6BFQ'],
  [1, 20771, A, 'P2AAAAAAIAABISHDX2Z4VLLSGTIQ'],
  [1, 20772, A, 'P2AAAAAAIAABISJQUPSUBO6ZWPJY'],
  [4294967295, 20771, A, 'P2777777YAABISGBGZGOT5ZD67E4'],
  [123456, 20800, B, 'P2AAA6EQAAABIUACOWLYZSIM4LWE'],
])('gera o vetor P2 id=%i dia=%i', (id, dia, segredo, esperado) => {
  expect(gerarCodigo('P2', id, dia, segredo)).toBe(esperado);
});

it('um P2 não confere como P1 com o mesmo segredo', () => {
  const dec = decodificarCodigo('P2AAAAAAIAABISHDX2Z4VLLSGTIQ')!;
  expect(dec.prefixo).toBe('P2');
  expect(conferirMac({ ...dec, prefixo: 'P1' }, A)).toBe(false);
});

it('dia de Brasília vira às 03:00 UTC', () => {
  expect(diaBrasiliaDe(new Date('2026-11-14T02:59:59Z'))).toBe(20770);
  expect(diaBrasiliaDe(new Date('2026-11-14T03:00:00Z'))).toBe(20771);
  expect(diaBrasiliaDe(new Date('2026-11-15T02:59:59Z'))).toBe(20771);
});
```

- [ ] **Step 2: Rodar e ver falhar.** `npx nx test api --testFile=credenciais/codigo-dinamico.p2.spec.ts` → FAIL (`diaBrasiliaDe` não existe; se os vetores falharem, o defeito está em `gerarCodigo` com `'P2'` e é corrigido aqui).
- [ ] **Step 3: Implementar `diaBrasiliaDe`.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** — `feat(credenciais): contador diário do código P2`.

### Task 3: Validação do `P2`

**Files:**
- Modify: `click-cond-web/apps/api/src/app/credenciais/credenciais-validacao.service.ts`
- Test: `click-cond-web/apps/api/src/app/credenciais/credenciais-validacao.p2.spec.ts`

**Interfaces:**
- Consumes: Tarefas 1 e 2; `validarLeitura`, `MotivoNegacao`, `TEXTO_NEGACAO`, `ResultadoLeitura` (projeto 1, Tarefa 4).
- Produces:
  - `MotivoNegacao` ganha `'carteira_desligada'`; `TEXTO_NEGACAO.carteira_desligada` = `Passe na carteira desligado neste condomínio`.
  - `CredenciaisValidacaoService.walletHabilitado(idCondominio: number): Promise<boolean>` — verdadeiro só com `qr_app_habilitado` **e** `wallet_habilitado`.
  - `validarLeitura` passa a tratar o prefixo conforme abaixo. A assinatura não muda. `runWebhook` não muda.

Regras, dentro da ordem de conferências que já existe em `validarLeitura`:

- **Casamento prefixo × origem**, logo depois de achar a credencial: `P1` só vale para `origem` `app` ou `link`; `P2` só vale para `origem` que começa com `wallet_`. Qualquer outra combinação → `desconhecida`.
- **Opção**: para `P2`, `qr_app_habilitado` desligada → `opcao_desligada`; ligada mas `wallet_habilitado` desligada → `carteira_desligada`.
- **Janela**: para `P2`, aceita `contador === diaBrasiliaDe(instante)` ou `contador === diaBrasiliaDe(instante) − 1`; fora disso → `expirado`. (Contador de amanhã também é `expirado`.)
- **Alvo**: `P2` só aceita credencial de `tipo_pessoa` `morador`.
- **Anti-reuso**: `P2` **não** grava em `Credenciais_Leituras` e nunca devolve `reuso`.
- O resultado `ok: true` de um `P2` devolve `contador` = o dia lido.

- [ ] **Step 1: Escrever os testes que falham**, com o mesmo `PrismaService` simulado do spec da Tarefa 4 do projeto 1:

```ts
it('P2 do dia atual de credencial wallet_apple abre e não grava em Credenciais_Leituras');
it('P2 do dia anterior abre (celular sem internet na virada)');
it('P2 de dois dias atrás é negado como expirado, não como assinatura (Review Focus 1)');
it('P2 do dia seguinte é negado como expirado');
it('o mesmo P2 lido duas vezes no mesmo leitor abre nas duas');
it('P2 com credencial de origem app é desconhecida; P1 com credencial wallet_google é desconhecida');
it('wallet_habilitado desligado → carteira_desligada; qr_app_habilitado desligado → opcao_desligada');
it('credencial revogada → revogada, na leitura seguinte ao cancelamento');
it('P2 de credencial de visita é desconhecida');
it('nenhum resultado contém o código lido ou o segredo');
```

- [ ] **Step 2: Rodar e ver falhar.** `npx nx test api --testFile=credenciais/credenciais-validacao.p2.spec.ts` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar**, e rodar `npx nx test api --testPathPattern=apps/api/src/app/credenciais` e `--testPathPattern=apps/api/src/app/facial` → PASS (o `P1` não pode regredir).
- [ ] **Step 5: Commit** — `feat(credenciais): validação do código diário P2`.

---

## Bloco B — Apple

### Task 4: Chaves do S3 e montagem do passe

**Files:**
- Modify: `click-cond-web/package.json` (dependências `node-forge` e `@types/node-forge`, via `npm install node-forge` e `npm install -D @types/node-forge` em `click-cond-web`)
- Create: `click-cond-web/apps/api/src/app/wallet/wallet-chaves.service.ts`
- Create: `click-cond-web/apps/api/src/app/wallet/apple-passe.builder.ts`
- Create: `click-cond-web/apps/api/src/assets/wallet/icon.png`, `icon@2x.png`, `icon@3x.png`, `logo.png`, `logo@2x.png`
- Test: `click-cond-web/apps/api/src/app/wallet/apple-passe.builder.spec.ts`, `wallet-chaves.service.spec.ts`

**Interfaces:**
- Consumes: `StorageService.lerObjetoTexto(key): Promise<string | null>` (`common/storage/storage.service.ts:293`; o módulo é `@Global`); `adm-zip`; `node-forge`.
- Produces:
  - `const PASS_TYPE_ID = 'pass.br.com.prestarecondominios.acesso'`; `const APPLE_TEAM_ID = '9FD7V97G5V'`
  - `const CHAVES_S3 = { applePassKey: 'config/wallet/apple/pass.key', applePassCert: 'config/wallet/apple/pass.pem', appleWwdr: 'config/wallet/apple/wwdr-g4.pem', googleConta: 'config/wallet/google/service-account.json', googleEmissor: 'config/wallet/google/emissor.json' }`
  - `type ChavesApple = { chavePem: string; certPem: string; wwdrPem: string }`
  - `type ChavesGoogle = { clientEmail: string; privateKeyPem: string; issuerId: string }`
  - `class WalletChavesService { apple(): Promise<ChavesApple | null>; google(): Promise<ChavesGoogle | null> }` — guarda em memória depois do primeiro sucesso; quando falta qualquer arquivo devolve `null` e só tenta de novo depois de 5 minutos (mesmo comportamento de `ApnsClient.obterJwt`, `card-ao-vivo/apns.client.ts:83-111`); JSON malformado conta como ausente; nunca lança e nunca loga conteúdo.
  - `type DadosDoPasse = { serial: string; authToken: string; webServiceUrl: string; condominio: string; morador: string; unidade: string; codigo: string | null /* null = passe inválido */ }`
  - `montarPasseApple(dados: DadosDoPasse, chaves: ChavesApple, imagens: Record<string, Buffer>): Buffer` — devolve o `.pkpass`.
  - `carregarImagensDoPasse(): Record<string, Buffer>` — lê os cinco PNG de `assets/wallet`.

Conteúdo de `pass.json` (passe do tipo `generic`):

| Campo | Valor |
|---|---|
| `formatVersion` | `1` |
| `passTypeIdentifier`, `teamIdentifier` | as constantes |
| `serialNumber`, `authenticationToken`, `webServiceURL` | de `dados` |
| `organizationName` | `Prestare` |
| `description` | `Passe de acesso Prestare` |
| `logoText` | `Prestare` |
| `sharingProhibited` | `true` |
| `backgroundColor` / `foregroundColor` / `labelColor` | `rgb(11,11,11)` / `rgb(255,255,255)` / `rgb(163,163,163)` |
| `generic.primaryFields` | `morador` — rótulo `MORADOR`, valor `dados.morador` |
| `generic.secondaryFields` | `condominio` — rótulo `CONDOMÍNIO`; `unidade` — rótulo `UNIDADE` |
| `generic.backFields` | `como_atualizar` — rótulo `Código não abre?`, valor `O código deste passe muda todo dia. Se o portão não abrir, toque nos três pontos do passe e puxe a tela para baixo para atualizar. É preciso internet.`; `cancelar` — rótulo `Perdeu o celular?`, valor `Peça à portaria ou ao síndico para cancelar o passe, ou cancele pelo app Prestare em Meu acesso.` |
| `barcodes` | um item: `format` `PKBarcodeFormatQR`, `message` `dados.codigo`, `messageEncoding` `iso-8859-1` |

Passe inválido (`dados.codigo === null`): acrescenta `voided: true` e `expirationDate` igual ao instante de montagem menos 1 minuto, e o `barcodes[0].message` é `PRESTARE-PASSE-CANCELADO`.

Pacote: `pass.json`, as imagens, `manifest.json` (SHA-1 de cada arquivo) e `signature` (PKCS#7 destacado, DER, do `manifest.json`, com o certificado do passe, o WWDR como certificado adicional e o atributo `signingTime`), compactados com `adm-zip`.

Imagens: geradas uma vez por script descartável (no scratchpad, não commitado) a partir de `apps/api/src/assets/marca/prestare-marca-preta.svg` com `sharp`, recoloridas para branco sobre transparente: `icon` 29/58/87 px, `logo` 160×50 e 320×100. Os cinco PNG são commitados.

- [ ] **Step 1: Escrever os testes que falham.** O spec gera um par RSA e dois certificados autoassinados com `node-forge` (um faz o papel do passe, outro do WWDR).

```ts
it('o pacote contém pass.json, manifest.json, signature e as cinco imagens');
it('manifest.json tem o SHA-1 de cada arquivo do pacote, exceto dele mesmo e da assinatura');
it('signature é um PKCS#7 destacado que verifica o manifest.json com o certificado de teste');
it('pass.json tem os campos e valores exatos da tabela, incluindo sharingProhibited true e as três cores');
it('o código vai em barcodes[0].message e em nenhum outro campo');
it('passe inválido: voided true, expirationDate no passado, message PRESTARE-PASSE-CANCELADO');
it('pass.json não contém CPF, foto, e-mail nem telefone');
describe('WalletChavesService', () => {
  it('devolve null quando falta qualquer um dos três arquivos da Apple, sem lançar');
  it('depois de null, só volta a consultar o S3 passados 5 minutos (Review Focus 4)');
  it('guarda em memória depois do primeiro sucesso');
  it('service-account.json malformado ou sem client_email conta como ausente');
  it('nenhuma chamada de logger recebe o conteúdo de uma chave');
});
```

- [ ] **Step 2: Rodar e ver falhar.** `npx nx test api --testPathPattern=apps/api/src/app/wallet` → FAIL.
- [ ] **Step 3: Gerar e commitar as imagens; implementar** `WalletChavesService`, `carregarImagensDoPasse` e `montarPasseApple`.
- [ ] **Step 4: Rodar e ver passar**; `npx nx typecheck api` → sem erros; `npx nx build api` → concluído e os PNG presentes na saída do build (se `assets/wallet` não for copiado, acrescentar a pasta aos `assets` do `project.json` da api, como `assets/marca`).
- [ ] **Step 5: Commit** — `feat(wallet): montagem e assinatura do passe da Apple`.

### Task 5: Emissão, situação e cancelamento

**Files:**
- Create: `click-cond-web/apps/api/src/app/wallet/wallet.service.ts`
- Create: `click-cond-web/apps/api/src/app/wallet/wallet.controller.ts`
- Create: `click-cond-web/apps/api/src/app/wallet/wallet.module.ts`
- Modify: `click-cond-web/apps/api/src/app/app.module.ts` (registrar `WalletModule` junto de `CredenciaisModule`)
- Modify: `click-cond-web/apps/api/src/app/credenciais/credenciais.service.ts` e `credenciais.controller.ts` (a rota de opção passa a levar `wallet_habilitado`)
- Test: `click-cond-web/apps/api/src/app/wallet/wallet.spec.ts`

**Interfaces:**
- Consumes: Tarefas 1 a 4; `encryptSecret`/`decryptSecret` (`facial/device-secret.util`); `UsuarioAppGuard`, `idUsuarioApp` (`auth/usuario-app.guard.ts`); `TenantAccessService.assertCondominio`; `assertOperador`, `assertSindico` (`auth/tenant.util.ts:96, 142`); `AuditoriaService.registrar` (`auditoria/auditoria.service.ts:63`); `gerarCodigo`, `diaBrasiliaDe`; `CredenciaisValidacaoService.walletHabilitado`.
- Produces:
  - `type Carteira = 'apple' | 'google'`
  - `class WalletService`:
    - `situacao(idUser: number, idCondominio: number): Promise<{ habilitado: boolean; apple: { disponivel: boolean; ativo: boolean }; google: { disponivel: boolean; ativo: boolean } }>`
    - `emitirApple(idUser: number, idCondominio: number): Promise<Buffer>`
    - `passeAppleDaCredencial(idCredencial: number): Promise<Buffer | null>` — usado pelo serviço da Apple (Tarefa 6); devolve passe válido ou inválido conforme o estado; `null` quando a credencial não existe ou não é `wallet_apple`.
    - `tokenDoPasse(idCredencial: number): string` — `authenticationToken`: base64url dos primeiros 24 bytes de `HMAC-SHA256(sha256(FACIAL_CRED_KEY || JWT_SECRET), "wallet-auth|" + idCredencial)`.
    - `cancelarDoUsuario(idUser: number, idCondominio: number): Promise<{ ok: true }>`
    - `cancelarPeloOperador(idMorador: number, operador: JwtPayload): Promise<{ ok: true; cancelados: number }>`
    - `marcarAtualizado(idsCredencial: number[]): Promise<void>` — grava `wallet_atualizado_em = agora` e dispara os avisos (Apple pela Tarefa 7, Google pela Tarefa 8; até essas tarefas existirem, só grava).
  - `WalletModule` exporta `WalletService` e `WalletChavesService`.
  - Rotas (prefixo global `/api`):

| Rota | Guarda | Entrada | Resposta 200 |
|---|---|---|---|
| `GET credenciais/wallet/situacao?id_condominio=` | `UsuarioAppGuard` | query | o objeto de `situacao` |
| `POST credenciais/wallet/apple` | `UsuarioAppGuard` | `{ id_condominio: number }` | corpo binário, `Content-Type: application/vnd.apple.pkpass`, `Content-Disposition: attachment; filename="prestare.pkpass"` |
| `POST credenciais/wallet/cancelar` | `UsuarioAppGuard` | `{ id_condominio: number }` | `{ ok: true }` |
| `POST credenciais/wallet/morador/:idMorador/cancelar` | JWT global + `assertOperador` | — | `{ ok: true, cancelados: number }` |
| `GET credenciais/condominio/:idCondominio/opcao` (existente) | — | — | passa a devolver também `wallet_habilitado: boolean` |
| `PATCH credenciais/condominio/:idCondominio/opcao` (existente) | síndico | aceita também `{ wallet_habilitado: boolean }` | os dois campos |

Regras:

- **Linha de morador**: a mesma do projeto 1 (`credenciais/minha`): primeira linha de `Moradores` com o `id_user` do token e o `id_condominio` pedido, por `id` crescente. Sem linha → 400 `Seu usuário não tem unidade vinculada neste condomínio.`
- **`situacao`**: `habilitado` = `walletHabilitado(idCondominio)`. `disponivel` = há chaves daquela carteira no S3. `ativo` = existe credencial daquela origem, não revogada, para a linha de morador. Nunca lança por falta de chave.
- **`emitirApple`**: opção desligada → 400 `Passe na carteira não está ativo neste condomínio.` Sem chaves → 503 `Passe na carteira indisponível no momento.` Havendo credencial `wallet_apple` ativa, **reaproveita** (mesmo `id`, mesmo segredo, mesmo número de série); senão cria com segredo de 32 bytes aleatórios cifrado por `encryptSecret`, `tipo_pessoa` `morador`, `id_pessoa` = `Moradores.id`. Dados do passe: `serial` = `c<id>`; `authToken` = `tokenDoPasse(id)`; `webServiceUrl` = `https://api.prestarecondominios.com.br/api/wallet/apple`; `condominio` = `Condominios.nome`; `morador` = `Moradores.nome`; `unidade` = `Bloco <bloco> · Apto <apartamento>` (omitindo a parte nula); `codigo` = `gerarCodigo('P2', id, diaBrasiliaDe(agora), segredo)`.
- **`passeAppleDaCredencial`**: `codigo` é `null` (passe inválido) quando a credencial está revogada, o morador não existe mais, ou `walletHabilitado` do condomínio é falso; senão o código do dia.
- **Cancelar (usuário)**: revoga (`revogada_em = agora`) as credenciais `wallet_apple` e `wallet_google` ativas daquela linha de morador naquele condomínio, e chama `marcarAtualizado`. Não toca na credencial `app`. Sem credencial ativa, responde `{ ok: true }` do mesmo jeito.
- **Cancelar (operador)**: carrega o morador, confere `assertCondominio(morador.id_condominio)`, revoga as duas origens, chama `marcarAtualizado`, e registra auditoria: `acao: 'UPDATE'`, `modulo: 'wallet'`, `entidade_id: idMorador`, `descricao: 'Cancelou o passe da carteira de <nome do morador>'`, `detalhes: { cancelados }`. `cancelados` = quantas credenciais foram revogadas.
- **Opção do condomínio**: `PATCH` com `wallet_habilitado: true` e `qr_app_habilitado` desligada → 400 `Ligue primeiro o QR no app.` `PATCH` com `qr_app_habilitado: false` desliga também `wallet_habilitado`. Toda mudança de `wallet_habilitado` chama `marcarAtualizado` para as credenciais de carteira ativas do condomínio (os passes passam a ser entregues inválidos ou válidos de novo), **sem revogar**.
- **Remoção do morador**: no ponto em que o projeto 1 revoga a credencial `app` na remoção ou inativação do morador, as credenciais de carteira são revogadas junto e `marcarAtualizado` é chamado. Se o projeto 1 não tiver esse ponto (lá a validação nega por `morador_removido`), o passe já é negado na leitura e entregue inválido por `passeAppleDaCredencial`; nesse caso basta chamar `marcarAtualizado` no `remove` do `MoradoresService` para as credenciais de carteira daquele morador.

- [ ] **Step 1: Escrever os testes que falham**, no estilo de `credenciais/credenciais.spec.ts`, com `WalletChavesService` falso devolvendo chaves de teste:

```ts
describe('emitir (Apple)', () => {
  it('cria credencial wallet_apple e devolve um pkpass cujo barcode valida em validarLeitura no mesmo instante');
  it('adicionar de novo devolve o mesmo número de série e o mesmo id de credencial');
  it('não cria nem altera a credencial de origem app');
  it('opção desligada → 400; sem chaves no S3 → 503 (Review Focus 4)');
  it('usuário sem linha de morador no condomínio → 400');
  it('morador em dois condomínios recebe passes com números de série diferentes');
});
describe('situação', () => {
  it('habilitado false quando qr_app_habilitado está desligado, mesmo com wallet_habilitado ligado');
  it('disponivel reflete a presença das chaves, por carteira; ativo reflete a credencial');
});
describe('cancelar', () => {
  it('pelo usuário: revoga apple e google daquele condomínio e não toca no outro condomínio nem na credencial app (Review Focus 2)');
  it('pelo operador: exige operador, exige o condomínio do morador, registra auditoria com o nome do morador');
  it('depois de cancelar, passeAppleDaCredencial devolve passe com voided true');
});
describe('opção do condomínio', () => {
  it('não liga wallet com QR no app desligado');
  it('desligar QR no app desliga wallet junto');
  it('desligar wallet não revoga: religar volta a entregar passe válido com o mesmo número de série');
});
```

- [ ] **Step 2: Rodar e ver falhar.** `npx nx test api --testFile=wallet/wallet.spec.ts` → FAIL.
- [ ] **Step 3: Implementar** serviço, controller e módulo (`imports: [CredenciaisNucleoModule]`; `AuditoriaService` como os módulos vizinhos o obtêm). Registrar em `app.module.ts`.
- [ ] **Step 4: Rodar e ver passar**; `npx nx typecheck api` → sem erros.
- [ ] **Step 5: Commit** — `feat(wallet): emissão do passe da Apple, situação e cancelamento`.

### Task 6: Serviço de atualização da Apple

**Files:**
- Create: `click-cond-web/apps/api/src/app/wallet/apple-servico.controller.ts`
- Modify: `click-cond-web/apps/api/src/app/wallet/wallet.module.ts`
- Test: `click-cond-web/apps/api/src/app/wallet/apple-servico.spec.ts`

**Interfaces:**
- Consumes: `WalletService.passeAppleDaCredencial`, `.tokenDoPasse`; `Wallet_Registros`; `Credenciais_Acesso.wallet_atualizado_em`; `PASS_TYPE_ID`.
- Produces: controller em `wallet/apple`, todas as rotas `@Public()` + `@SkipAudit()` + `@Throttle({ medium: { limit: 120, ttl: 60_000 } })`:

| Rota | Autenticação | Resposta |
|---|---|---|
| `POST v1/devices/:deviceId/registrations/:passTypeId/:serial` com `{ pushToken }` | `Authorization: ApplePass <token>` | `201` quando cria o registro; `200` quando já existia (atualiza o `push_token`) |
| `GET v1/devices/:deviceId/registrations/:passTypeId?passesUpdatedSince=<tag>` | nenhuma | `200 { serialNumbers: string[], lastUpdated: string }` ou `204` sem corpo |
| `GET v1/passes/:passTypeId/:serial` | `ApplePass` | `200` com o `.pkpass` e `Last-Modified` |
| `DELETE v1/devices/:deviceId/registrations/:passTypeId/:serial` | `ApplePass` | `200` |
| `POST v1/log` com `{ logs: string[] }` | nenhuma | `200` |

Regras:

- Número de série é `c<id>`; qualquer outro formato → `404` nas rotas autenticadas.
- `passTypeId` diferente de `PASS_TYPE_ID` → `404`.
- Token: comparação em tempo constante com `tokenDoPasse(id)`. Cabeçalho ausente, malformado ou errado → `401`. A conferência do token vem **antes** de consultar o banco.
- Registrar sem `pushToken` no corpo → `400`.
- Listagem: `lastUpdated` é o maior `wallet_atualizado_em` das credenciais registradas naquele aparelho, em milissegundos unix como texto. `passesUpdatedSince` ausente → devolve todas; presente → só as com `wallet_atualizado_em` maior; valor não numérico é tratado como ausente. Nada a devolver → `204`. A resposta só contém números de série e `lastUpdated`.
- Entrega do passe: usa `passeAppleDaCredencial`; `null` → `404`. Sempre `200` com o passe inteiro (sem tratar `If-Modified-Since`).
- Remover registro que não existe → `200`.
- Log: grava uma linha de `Logger.warn` com a **quantidade** de mensagens e os primeiros 200 caracteres da primeira, depois de remover qualquer sequência de 20 ou mais caracteres hexadecimais ou base64. Corpo malformado → `200`.
- Nenhuma rota devolve `500` para entrada que não é nossa.

- [ ] **Step 1: Escrever os testes que falham:**

```ts
it('registrar com token certo cria Wallet_Registros e responde 201; repetir responde 200 e atualiza o push_token');
it('registrar, entregar e remover com token errado, ausente ou de outro passe respondem 401 sem consultar o banco');
it('entregar devolve pkpass com o código P2 do dia e Last-Modified');
it('entregar passe de credencial revogada devolve pkpass com voided true');
it('aparelho que passou dois dias offline recebe o código de hoje, não o de anteontem (Review Focus 1)');
it('listar sem passesUpdatedSince devolve todos os números de série do aparelho');
it('listar com passesUpdatedSince igual ao lastUpdated responde 204');
it('listar com passesUpdatedSince que não é número se comporta como ausente (Review Focus 3)');
it('listar aparelho desconhecido responde 204');
it('a listagem só contém serialNumbers e lastUpdated');
it('série fora do formato c<id> e passTypeId de outro emissor respondem 404 (Review Focus 3)');
it('registrar sem pushToken responde 400');
it('remover registro inexistente responde 200');
it('log: responde 200, loga a quantidade, e não loga token');
```

- [ ] **Step 2: Rodar e ver falhar.** `npx nx test api --testFile=wallet/apple-servico.spec.ts` → FAIL.
- [ ] **Step 3: Implementar** o controller. Conferir em `common/limite-corpo.ts` que as rotas `wallet/apple` recebem o corpo JSON pelo parser padrão (o `bodyParser` do Nest está desligado em `main.ts:49`).
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** — `feat(wallet): serviço de atualização de passes da Apple`.

### Task 7: Aviso de atualização por APNs com certificado

**Files:**
- Create: `click-cond-web/apps/api/src/app/wallet/apple-push.client.ts`
- Modify: `click-cond-web/apps/api/src/app/wallet/wallet.service.ts` (`marcarAtualizado` passa a avisar)
- Test: `click-cond-web/apps/api/src/app/wallet/apple-push.client.spec.ts`

**Interfaces:**
- Consumes: `RespostaApns`, `tokenMorto`, `APNS_HOST` de `card-ao-vivo/apns.client.ts` (exportados; não alterar esse arquivo); `WalletChavesService.apple()`; `PASS_TYPE_ID`.
- Produces:
  - `class ApplePassPushClient { constructor(chaves: () => Promise<ChavesApple | null>, host?: string); avisar(pushToken: string): Promise<RespostaApns> }`
  - Em `WalletService`: `avisarApple(idsCredencial: number[]): Promise<{ avisados: number; mortos: number; falhas: number }>`; `marcarAtualizado` chama `avisarApple` depois de gravar.

Regras:

- Conexão HTTP/2 com **certificado de cliente** (`http2.connect(host, { cert: certPem, key: chavePem })`), sem JWT. Uma sessão reaproveitada, descartada em `error` e `goaway`, com `unref()`, como em `ApnsClient.obterSessao`.
- Requisição: `POST /3/device/<pushToken>`, corpo `{}`, cabeçalhos `apns-topic: PASS_TYPE_ID`, `apns-push-type: background`, `apns-priority: 5`, `apns-expiration: <unix agora + 86 400>` (validade de um dia, para alcançar o aparelho que estava sem internet).
- Timeout de 8 s por requisição e a mesma disciplina de resolução única de `ApnsClient.post` (`apns.client.ts:138-185`): timeout resolve `{ status: 0, motivo: 'timeout' }`; sessão caída tenta uma vez numa sessão nova; segunda falha resolve `{ status: 0, motivo: 'rede' }`. Nunca rejeita.
- Sem chaves: resolve `{ status: 0, motivo: 'sem-chave' }` sem abrir conexão.
- `avisarApple`: para cada registro das credenciais dadas, avisa; `tokenMorto(resposta)` → apaga aquele `Wallet_Registros` e conta em `mortos`; outra falha conta em `falhas` e não interrompe; nunca lança.

- [ ] **Step 1: Escrever os testes que falham**, com um servidor HTTP/2 local de teste (`http2.createSecureServer` com certificado autoassinado gerado no spec, `requestCert: true`) apontado pelo parâmetro `host`:

```ts
it('envia POST /3/device/<token> com corpo {} e os quatro cabeçalhos, autenticando com o certificado de cliente');
it('sem chaves resolve sem-chave e não abre conexão');
it('servidor que não responde resolve timeout em 8 s (com timers falsos) e não deixa promessa pendurada');
it('sessão derrubada: tenta uma vez numa sessão nova');
it('avisarApple: um token morto no meio é apagado e os outros são avisados (Review Focus 5)');
it('avisarApple nunca lança, mesmo com todos falhando');
it('nenhuma chamada de logger recebe o push token inteiro');
```

- [ ] **Step 2: Rodar e ver falhar.** `npx nx test api --testFile=wallet/apple-push.client.spec.ts` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar**, e rodar de novo `wallet/wallet.spec.ts` (o cancelamento agora avisa) → PASS.
- [ ] **Step 5: Commit** — `feat(wallet): aviso de atualização do passe por APNs`.

---

## Bloco C — Troca diária e Google

### Task 8: Tarefa diária

**Files:**
- Modify: `click-cond-web/apps/api/src/app/wallet/wallet.service.ts`
- Test: `click-cond-web/apps/api/src/app/wallet/wallet-tick.spec.ts`

**Interfaces:**
- Consumes: `executarComLock` (`common/lock-distribuido.ts:174`) com `cicloDeNegocio`; `horaBrasilia`, `hojeBrasilia` (`common/hora-brasilia.util.ts:40, 49`); `avisarApple`; (depois da Tarefa 9) `GoogleWalletClient.atualizarCodigo`.
- Produces: em `WalletService`: `tickDiario(): Promise<{ apple: number; google: number }>` e o agendamento em `onModuleInit`.

Regras:

- Agendamento igual ao de `facial.service.ts:529-530`: um `setTimeout` de 5 minutos e um `setInterval` de 1 hora, ambos `unref()`, chamando `executarComLock(this.prisma, 'wallet:tickDiario', () => this.tickDiario(), { cicloDeNegocio })`, onde `cicloDeNegocio` devolve `null` quando `horaBrasilia() !== 0` e a data de Brasília (`AAAA-MM-DD`) caso contrário. Nada é agendado com `NODE_ENV === 'test'`.
- `tickDiario`: seleciona as credenciais de carteira não revogadas de condomínios com `qr_app_habilitado` e `wallet_habilitado` ligadas. Grava `wallet_atualizado_em = agora` em todas e chama `avisarApple` para as `wallet_apple`. Para as `wallet_google`, atualiza o código no Google (Tarefa 9; antes dela, conta zero).
- Sem chaves de uma carteira, aquela metade é pulada sem erro (Review Focus 4).
- Falha em uma credencial não interrompe as demais. `tickDiario` só lança se a consulta inicial ao banco falhar (para o ciclo não ser marcado como feito e repetir na hora seguinte, como o lock já faz).

- [ ] **Step 1: Escrever os testes que falham:**

```ts
it('avisa só as credenciais de carteira ativas de condomínios com as duas opções ligadas');
it('grava wallet_atualizado_em nas credenciais avisadas');
it('sem chaves da Apple no S3: não lança e devolve apple 0 (Review Focus 4)');
it('um aparelho falhando não impede os demais (Review Focus 5)');
it('falha na consulta inicial faz tickDiario lançar');
it('cicloDeNegocio devolve null fora da hora 0 de Brasília e a data dentro dela');
it('depois do tick, o passe entregue pelo serviço da Apple traz o código do dia novo');
```

- [ ] **Step 2: Rodar e ver falhar.** `npx nx test api --testFile=wallet/wallet-tick.spec.ts` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** — `feat(wallet): troca diária do código do passe`.

### Task 9: Google Wallet

**Files:**
- Create: `click-cond-web/apps/api/src/app/wallet/google-wallet.client.ts`
- Modify: `click-cond-web/apps/api/src/app/wallet/wallet.service.ts`, `wallet.controller.ts`
- Test: `click-cond-web/apps/api/src/app/wallet/google-wallet.spec.ts`

**Interfaces:**
- Consumes: `WalletChavesService.google()`; `node:crypto` (`createSign('RSA-SHA256')`); `fetch` global.
- Produces:
  - `class GoogleWalletClient { constructor(chaves: () => Promise<ChavesGoogle | null>, buscar?: typeof fetch); linkDeAdicionar(obj: ObjetoGoogle): Promise<string | null>; atualizarCodigo(idCredencial: number, codigo: string): Promise<boolean>; inativar(idCredencial: number): Promise<boolean>; reativar(idCredencial: number, codigo: string): Promise<boolean> }`
  - `type ObjetoGoogle = { idCredencial: number; condominio: string; morador: string; unidade: string; codigo: string }`
  - Em `WalletService`: `emitirGoogle(idUser: number, idCondominio: number): Promise<{ url: string }>`; `marcarAtualizado` e `tickDiario` passam a tratar as credenciais `wallet_google`.
  - Rota `POST credenciais/wallet/google` — `UsuarioAppGuard`, `{ id_condominio: number }` → `{ url: string }`.

Regras:

- Identificadores: classe `<issuer_id>.prestare_acesso_v1`; objeto `<issuer_id>.cred<idCredencial>`.
- **Link de adicionar**: `https://pay.google.com/gp/v/save/<jwt>`, JWT RS256 assinado com a chave da conta de serviço, com `iss` = `clientEmail`, `aud` = `google`, `typ` = `savetowallet`, `iat` = agora, e `payload` contendo `genericClasses` (a classe) e `genericObjects` (o objeto). Levar a classe no próprio JWT dispensa criá-la antes pela API.
- **Classe**: `multipleDevicesAndHoldersAllowedStatus` = `ONE_USER_ALL_DEVICES`.
- **Objeto**: `state` `ACTIVE`; `cardTitle` `Prestare`; `header` = nome do morador; `subheader` `MORADOR`; `hexBackgroundColor` `#0B0B0B`; `textModulesData` com condomínio e unidade; `barcode` `{ type: 'QR_CODE', value: codigo }`; logo apontando para `https://www.prestarecondominios.com.br/logo-prestare.png` (arquivo já público em `apps/portaria-web/public`). Sem foto, sem CPF.
- **Chamadas REST** (`https://walletobjects.googleapis.com/walletobjects/v1/genericObject/<id>`): token de acesso obtido por asserção JWT da conta de serviço em `https://oauth2.googleapis.com/token` com escopo `https://www.googleapis.com/auth/wallet_object.issuer`, guardado em memória até 5 minutos antes de vencer. `atualizarCodigo` → `PATCH { barcode: { type, value } }`; `inativar` → `PATCH { state: 'INACTIVE' }`; `reativar` → `PATCH { state: 'ACTIVE', barcode }`. Resposta `404` (o morador gerou o link mas não salvou o passe) conta como sucesso. Timeout de 8 s por chamada. Nunca lançam; devolvem `false` em falha.
- Sem chaves: `linkDeAdicionar` devolve `null` e as demais devolvem `false`, sem chamada de rede.
- **`emitirGoogle`**: mesmas conferências de `emitirApple` (opção, linha de morador); sem chaves → 503 `Passe na carteira indisponível no momento.`; reaproveita ou cria a credencial `wallet_google`; código do dia; devolve `{ url }`.
- **`marcarAtualizado`** para credencial `wallet_google`: revogada, morador removido ou opção desligada → `inativar`; senão `reativar` com o código do dia.
- **`tickDiario`**: para cada `wallet_google` selecionada, `atualizarCodigo` com o código do dia.
- Em produção, enquanto `service-account.json` e `emissor.json` não existirem no S3, `situacao.google.disponivel` é `false` e o app não mostra o botão: esse é o interruptor do lado Google.

- [ ] **Step 1: Escrever os testes que falham**, com par RSA gerado no spec e `buscar` falso:

```ts
it('linkDeAdicionar devolve URL pay.google.com/gp/v/save/<jwt> cujo JWT verifica com a chave pública de teste');
it('o JWT tem iss, aud google, typ savetowallet, e o objeto com o código P2 no barcode');
it('a classe vai com ONE_USER_ALL_DEVICES');
it('o objeto não contém CPF, foto, e-mail nem telefone');
it('atualizarCodigo, inativar e reativar fazem PATCH no objeto certo com Bearer do token de acesso');
it('o token de acesso é reaproveitado entre chamadas e renovado perto de vencer');
it('404 do Google conta como sucesso; 500 e timeout devolvem false sem lançar');
it('sem chaves: link null, demais false, nenhuma chamada de rede');
it('emitirGoogle reaproveita a credencial wallet_google numa segunda chamada');
it('cancelar inativa o objeto; desligar a opção inativa; religar reativa com o código do dia');
it('tickDiario atualiza o código das credenciais wallet_google');
it('nenhuma chamada de logger recebe a chave privada nem o token de acesso');
```

- [ ] **Step 2: Rodar e ver falhar.** `npx nx test api --testFile=wallet/google-wallet.spec.ts` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar**; rodar a pasta inteira `npx nx test api --testPathPattern=apps/api/src/app/wallet` → PASS; `npx nx typecheck api` → sem erros.
- [ ] **Step 5: Commit** — `feat(wallet): passe na Google Wallet`.

---

## Bloco D — Portaria-web

### Task 10: Opção do condomínio e cancelamento pelo operador

**Files:**
- Modify: `click-cond-web/apps/portaria-web/src/app/configuracoes/configuracoes-page.component.ts`, `.html`
- Modify: `click-cond-web/apps/portaria-web/src/app/moradores/moradores.service.ts`, `moradores-page.component.ts`, `.html`
- Test: `click-cond-web/apps/portaria-web/src/app/configuracoes/configuracoes-page.wallet.spec.ts`, `click-cond-web/apps/portaria-web/src/app/moradores/moradores-page.wallet.spec.ts`

**Interfaces:**
- Consumes: `GET`/`PATCH {API_BASE}/credenciais/condominio/:idCondominio/opcao` (agora com `wallet_habilitado`); `POST {API_BASE}/credenciais/wallet/morador/:idMorador/cancelar`; a seção "QR no app" criada na Tarefa 9 do projeto 1.
- Produces:
  - Em `MoradoresApi`: `cancelarPasseCarteira(idMorador: number): Observable<{ ok: true; cancelados: number }>`.
  - Controle "Passe na carteira" dentro da seção "QR no app" das configurações.
  - Botão "Cancelar passe da carteira" no formulário de edição do morador (só ao editar um morador existente, junto do bloco de veículos, `moradores-page.component.ts:228`).

Textos exatos:

- Aviso antes de ligar a opção: **"O passe na carteira abre sem o app e, no iPhone, até com a tela bloqueada. O código muda uma vez por dia, então é menos seguro que o QR do app: um print vale até o dia seguinte, e uma cópia do passe continua recebendo o código novo até alguém cancelar. Se um morador perder o celular, cancele o passe dele em Moradores."**
- Confirmação do cancelamento: **"Cancelar o passe da carteira de {nome}? O passe deixa de abrir na hora. O QR do app e o rosto continuam funcionando."**
- Depois de cancelar: `Passe cancelado.` quando `cancelados > 0`; `Este morador não tinha passe ativo.` quando `0`.

Comportamento: o controle "Passe na carteira" fica desabilitado, com a dica `Ligue primeiro o QR no app.`, enquanto "QR no app" está desligado; desligar "QR no app" mostra o passe como desligado também. Os dois controles só aparecem para síndico. O botão de cancelar aparece para operador (síndico ou porteiro).

- [ ] **Step 1: Escrever os testes que falham** (estilo de `configuracoes-page.perfil.spec.ts` e `edicao-morador.spec.ts`): ligar pede confirmação com o texto exato e envia `PATCH { wallet_habilitado: true }`; controle desabilitado com QR no app desligado; erro do servidor volta o controle; botão só ao editar morador existente; confirmação com o nome; as duas mensagens de resultado; erro do servidor mostra a mensagem do servidor e não fecha o formulário.
- [ ] **Step 2: Rodar e ver falhar.** `npx nx test portaria-web --testFile=configuracoes/configuracoes-page.wallet.spec.ts` e `--testFile=moradores/moradores-page.wallet.spec.ts` → FAIL.
- [ ] **Step 3: Implementar**, com as classes Prestare Dark já usadas nas duas páginas.
- [ ] **Step 4: Rodar e ver passar**; `npx nx build portaria-web` → concluído.
- [ ] **Step 5: Commit** — `feat(portaria-web): opção do passe na carteira e cancelamento pelo operador`.

---

## Bloco E — App Flutter

(Comandos em `click-cond-app/click-cond-app`.)

### Task 11: Seção da carteira na tela "Meu acesso"

**Files:**
- Create: `click-cond-app/click-cond-app/lib/controllers/controller_wallet.dart`
- Create: `click-cond-app/click-cond-app/lib/pages/shared/meu_acesso/passe_carteira_secao.dart`
- Create: `click-cond-app/click-cond-app/assets/images/wallet/adicionar_apple_wallet.png`, `adicionar_google_wallet.png` (e `pubspec.yaml`: pasta `assets/images/wallet/`)
- Modify: `click-cond-app/click-cond-app/lib/pages/shared/meu_acesso/meu_acesso_page.dart`
- Test: `click-cond-app/click-cond-app/test/passe_carteira_secao_test.dart`

**Interfaces:**
- Consumes: `ApiClient`, `ApiConfig.buildUri` (como em `controller_credencial.dart`, projeto 1, Tarefa 11); `MeuAcessoPage` (projeto 1, Tarefa 12); `open_filex`, `path_provider`, `url_launcher` (já no `pubspec.yaml`); `dart:io` `Platform`.
- Produces:
  - `controller_wallet.dart`: `Future<Map<String, dynamic>> apiWalletSituacao(int idCondominio)`; `Future<List<int>?> apiWalletPasseApple(int idCondominio)` (bytes do `.pkpass`, `null` em erro); `Future<Map<String, dynamic>> apiWalletLinkGoogle(int idCondominio)`; `Future<Map<String, dynamic>> apiWalletCancelar(int idCondominio)`. As que devolvem mapa seguem a convenção `{ "erro": <mensagem> }` das vizinhas.
  - `class PasseCarteiraSecao extends StatefulWidget { const PasseCarteiraSecao({required this.idCondominio, this.plataforma, this.abrirArquivo, this.abrirUrl}); }` — os três últimos parâmetros são pontos de troca para teste (`TargetPlatform?`, `Future<void> Function(String caminho)?`, `Future<void> Function(Uri)?`).

Comportamento:

- A seção aparece abaixo do QR, só quando a tela está em `SituacaoCredencial.pronta`. Carrega `apiWalletSituacao`; enquanto carrega, ou em erro, ou com `habilitado: false`, **não mostra nada** (sem esqueleto, sem mensagem de erro).
- iPhone: mostra o botão só se `apple.disponivel`. Android: só se `google.disponivel`. Outras plataformas: nada.
- Botão: a arte oficial "Adicionar à Carteira da Apple" / "Adicionar à Carteira do Google" em português, baixada das páginas oficiais de marca de cada empresa, sem recortar nem recolorir, altura 48, com `Semantics(label: …)` igual ao texto da arte.
- iPhone, ao tocar: baixa o passe, grava em `<diretório temporário>/prestare.pkpass` e abre com `OpenFilex.open(caminho, type: 'application/vnd.apple.pkpass')`. O sistema mostra a folha de adicionar.
- Android, ao tocar: pede o link e abre com `launchUrl(uri, mode: LaunchMode.externalApplication)`.
- Com `ativo: true` na carteira da plataforma: abaixo do botão, o texto `Passe ativo na carteira.` e a ação de texto `Cancelar passe`. O botão de adicionar continua visível ("adicionar novamente").
- "Cancelar passe" pede confirmação — **"Cancelar o passe da carteira? Ele deixa de abrir na hora, em todos os aparelhos. O QR desta tela continua funcionando."** — chama `apiWalletCancelar` e recarrega a situação.
- Erro ao adicionar ou cancelar: `SnackBar` com a mensagem do servidor, ou `Não foi possível concluir. Tente de novo.` quando não houver.
- A situação é recarregada quando o app volta ao primeiro plano (o usuário acabou de sair para a carteira).

- [ ] **Step 1: Escrever os testes de widget que falham**, com as funções de API substituídas:

```dart
testWidgets('habilitado false, erro ou carregando: a seção não desenha nada');
testWidgets('iPhone com apple.disponivel: mostra o botão da Apple e não o do Google');
testWidgets('Android com google.disponivel: mostra o botão do Google e não o da Apple');
testWidgets('iPhone com apple.disponivel false: não mostra botão');
testWidgets('tocar no botão da Apple grava o arquivo e chama abrirArquivo com caminho terminado em .pkpass');
testWidgets('tocar no botão do Google chama abrirUrl com a url devolvida');
testWidgets('ativo true: mostra "Passe ativo na carteira." e "Cancelar passe", e mantém o botão de adicionar');
testWidgets('cancelar pede confirmação com o texto exato, chama a API e recarrega');
testWidgets('erro do servidor aparece em SnackBar');
```

- [ ] **Step 2: Rodar e ver falhar.** `flutter test test/passe_carteira_secao_test.dart` → FAIL.
- [ ] **Step 3: Implementar**; incluir a seção em `MeuAcessoPage`. Não alterar `ios/Runner/Click.entitlements`.
- [ ] **Step 4: Rodar e ver passar**; `flutter analyze --no-fatal-infos --no-fatal-warnings` → sem erros; `flutter test` → todos PASS.
- [ ] **Step 5: Commit** — `feat(app): adicionar o passe à carteira pela tela Meu acesso`.

---

## Bloco F — Operação e fechamento

### Task 12: Chaves no S3 privado (operação)

Esta tarefa não escreve código de produto. Ela mexe em produção e **só é executada com o dono do produto ciente**; o comando de subida é dele ou é rodado com a sessão dele.

**Files:**
- Create: `docs/operacao/wallet-implantacao.md`

**Interfaces:**
- Consumes: os arquivos em `C:/Users/vinic/.prestare-wallet/` (`pass.key`, `pass.pem`); o bucket privado da API (`prestare-arquivos-850401152034`).
- Produces: os três objetos da Apple no S3, nas chaves de `CHAVES_S3`; o guia.

- [ ] **Step 1: Obter o intermediário WWDR G4.** Baixar `AppleWWDRCAG4.cer` de `https://www.apple.com/certificateauthority/` para `C:/Users/vinic/.prestare-wallet/` e converter: `openssl x509 -inform DER -in AppleWWDRCAG4.cer -out wwdr-g4.pem`. Conferir a cadeia: `openssl verify -partial_chain -CAfile wwdr-g4.pem pass.pem` → `pass.pem: OK`.
- [ ] **Step 2: Conferir o par** sem imprimir a chave: comparar `openssl x509 -in pass.pem -noout -pubkey | openssl md5` com `openssl pkey -in pass.key -pubout | openssl md5` → iguais. Não abrir, copiar nem colar o conteúdo de `pass.key` em lugar algum.
- [ ] **Step 3: Subir os três arquivos** para o bucket privado, com criptografia do lado do servidor, nas chaves `config/wallet/apple/pass.key`, `config/wallet/apple/pass.pem` e `config/wallet/apple/wwdr-g4.pem`. Esta máquina não tem credencial da AWS: a subida é feita pelo console da AWS (S3 → bucket → Upload) ou pelo CloudShell com upload de arquivo. Conferir no console que os três objetos existem e que o bucket continua sem acesso público.
- [ ] **Step 4: Conferir em produção**, depois de a API estar publicada e de a opção estar ligada num condomínio de teste: `GET /api/credenciais/wallet/situacao?id_condominio=<teste>` → `apple.disponivel: true`. A API percebe os arquivos em até 5 minutos, sem reinício.
- [ ] **Step 5: Escrever o guia** `docs/operacao/wallet-implantacao.md`:
  1. Ordem de publicação: SQL do projeto 1, depois `prisma/manual_2026-11_wallet.sql`, conferir tabela e colunas; publicar API e portaria-web; subir as chaves; por último o app.
  2. Onde ficam as chaves e como trocá-las. O certificado do passe vence em **14/12/2027**: renovar antes, com o mesmo Pass Type ID, e substituir `pass.pem` (e `pass.key`, se o pedido for novo). Passes já instalados continuam valendo.
  3. Google: passo a passo para o dono (conta de emissor, conta de serviço, adicionar a conta de serviço como usuário no console da carteira, pedir acesso de publicação), o formato de `emissor.json`, e que o botão do Android aparece sozinho quando os dois arquivos estiverem no S3. Antes da aprovação do Google, só contas de teste cadastradas no console conseguem salvar o passe.
  4. Só ligar "Passe na carteira" com "QR no app" ligada, e depois de o app novo estar disponível.
  5. Celular perdido: Moradores → editar → "Cancelar passe da carteira".
  6. Limites conhecidos, em linguagem de síndico: código diário; print vale até o dia seguinte; cópia do passe segue atualizando até o cancelamento; depende de internet no condomínio e, uma vez por dia, no celular.
  7. Teste manual em aparelho real: adicionar o passe num iPhone, ler num leitor de QR do condomínio de teste, cancelar e conferir que o passe aparece inválido e é negado.
- [ ] **Step 6: Commit** — `docs(wallet): guia de implantação e operação das chaves` (só o guia; nenhum arquivo de chave entra no repositório).

### Task 13: Verificação completa

**Files:** nenhum novo.

**Interfaces:**
- Consumes: tudo o que veio antes.

- [ ] **Step 1: API.** Em `click-cond-web`: `npx nx typecheck api` → sem erros; `npx nx test api` → todos PASS; `npx nx build api` → concluído.
- [ ] **Step 2: Portaria-web.** `npx nx test portaria-web` → todos PASS; `npx nx build portaria-web` → concluído.
- [ ] **Step 3: App.** Em `click-cond-app/click-cond-app`: `flutter pub get`; `flutter analyze --no-fatal-infos --no-fatal-warnings` → sem erros; `flutter test` → todos PASS.
- [ ] **Step 4: Varredura de segredo.** `git diff origin/master --stat` não lista `.key`, `.pem`, `.cer`, `.p12` nem `service-account*.json`. `grep -rn "BEGIN .*PRIVATE KEY\|BEGIN CERTIFICATE" click-cond-web/apps click-cond-app/click-cond-app/lib` → vazio (os specs geram chaves em tempo de execução). Nos arquivos de `apps/api/src/app/wallet`, nenhum `logger.*` interpola `pushToken`, `authToken`, `segredo`, `codigo` ou conteúdo de chave.
- [ ] **Step 5: Nenhuma variável de ambiente nova.** `grep -rn "process.env\[" click-cond-web/apps/api/src/app/wallet` → só `NODE_ENV`, `FACIAL_CRED_KEY`, `JWT_SECRET`.
- [ ] **Step 6: Idempotência do SQL.** Ler `prisma/manual_2026-11_wallet.sql` de ponta a ponta confirmando que cada instrução é segura numa segunda execução (não executar contra banco algum).
- [ ] **Step 7: Passe de teste abre de verdade.** Com as chaves reais já no S3 (Tarefa 12) e a API publicada, gerar um passe pelo app num iPhone e conferir que a Carteira o aceita. Se a Carteira recusar, o defeito está na assinatura ou no `pass.json`: usar superpowers:systematic-debugging a partir do log do aparelho (o serviço `v1/log` recebe o motivo). Sem aparelho ou sem as chaves no S3, registrar "não verificado em aparelho real" no guia.
- [ ] **Step 8: Commit** de qualquer ajuste — `chore(wallet): verificação final`.

---

## Decisões tomadas neste plano (onde o desenho deixava ao implementador)

- **Assinatura do passe** com `node-forge` (PKCS#7 destacado); **zip** com `adm-zip`, que já existe. Nenhuma biblioteca de "passkit" pronta.
- **Google sem biblioteca**: JWT RS256 com `node:crypto` e chamadas com `fetch`. A classe viaja dentro do link de adicionar, então não há passo de "criar classe".
- **Configuração do Google em dois objetos no S3** (`service-account.json` e `emissor.json`), para não criar variável de ambiente. A ausência deles é o interruptor do Android pedido no desenho.
- **`authenticationToken` derivado** por HMAC do id da credencial, sem coluna nova e sem guardar o token.
- **Número de série** `c<id da credencial>`: cancelar e adicionar de novo cria outra credencial e, portanto, outro passe; o antigo fica inválido.
- **Coluna `wallet_atualizado_em`** em `Credenciais_Acesso` para responder "quais passes mudaram desde…" ao serviço da Apple.
- **Rota `GET credenciais/wallet/situacao`**, que o desenho não listava: é como o app sabe se mostra o botão.
- **A opção do condomínio** viaja na rota de opção do projeto 1, com o campo `wallet_habilitado`.
- **Apresentar o passe no iPhone** com `open_filex`, que já está no app, em vez de pacote novo de carteira.
- **Aviso por APNs em cliente próprio** (`apple-push.client.ts`), sem alterar o `ApnsClient` do card ao vivo; reaproveita `RespostaApns`, `tokenMorto` e `APNS_HOST`.
- **Imagens do passe commitadas** como PNG, geradas uma vez da marca em SVG.
- **Auditoria do cancelamento pelo operador** com `acao: 'UPDATE'`, `modulo: 'wallet'` (não há ação específica na lista de `AuditoriaAcao`).
- **Textos** do verso do passe, do aviso ao síndico e das confirmações estão fixados neste plano.
