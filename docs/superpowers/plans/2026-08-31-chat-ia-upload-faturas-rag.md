# PRESTARE IA — Upload de Faturas com IA Multimodal RAG e Integração Financeira Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o morador tire fotos ou anexe arquivos (PDF/imagens) de contas e faturas no PRESTARE IA, utilizando leitura multimodal e RAG para extrair os dados e lançar automaticamente no Financeiro pessoal.

**Architecture:** O Flutter app (`chat_ia_page.dart`) ganha botão de anexo (câmera, galeria, documento) com preview flutuante e envio em Base64. A API NestJS (`chat-ia`) injeta a imagem/documento via `inlineData` no Gemini 3.6 Flash com contexto RAG do morador, que identifica a concessionária, categoria, valor, vencimento e código de barras/PIX, acionando a ferramenta `propor_conta_morador` para confirmação e salvamento direto no Financeiro.

**Tech Stack:** Flutter / Dart, Phosphor Icons, image_picker, file_picker, NestJS / TypeScript, Google Gemini Multimodal REST API, Prisma ORM, MySQL.

**Spec:** `docs/superpowers/specs/2026-08-31-chat-ia-upload-faturas-rag.md`

## Global Constraints

- Backend deve manter validação de tenant e permissão JWT (`assertCondominio`).
- Payload de anexo deve limitar o tamanho de envio (máx 10MB) e suportar `image/jpeg`, `image/png`, `image/webp`, `application/pdf`.
- O modelo de IA nunca grava sozinho sem o consentimento do morador: sempre apresenta o card de confirmação com os dados extraídos antes da persistência.
- O código gerado no Flutter deve manter padrão de design do aplicativo (AppColors, AppTypography, AppSpacing).

---

### Task 1: Backend - Suporte a Anexos Multimodais no `ChatIaController` e `ChatIaService`

**Files:**
- Modify: `click-cond-web/apps/api/src/app/chat-ia/chat-ia.controller.ts:30-46`
- Modify: `click-cond-web/apps/api/src/app/chat-ia/chat-ia.service.ts:100-150`
- Modify: `click-cond-web/apps/api/src/app/chat-ia/gemini.client.ts:60-70`
- Test: `click-cond-web/apps/api/src/app/chat-ia/chat-ia.multimodal.spec.ts`

**Interfaces:**
- Consumes: `GeminiClient`, `ConteudoGemini`
- Produces: DTO estendido no `POST /chat-ia/perguntar` com `{ arquivo?: { nome?: string, mime_type: string, base64: string } }` e inclusão de `inlineData` nos `contents` do Gemini.

- [ ] **Step 1: Write the failing unit test**

```typescript
// click-cond-web/apps/api/src/app/chat-ia/chat-ia.multimodal.spec.ts
import { Test } from '@nestjs/testing';
import { ChatIaService } from './chat-ia.service';

describe('ChatIaService - Anexos Multimodais', () => {
  it('deve formatar anexo de imagem em inlineData para o Gemini', async () => {
    const service = {} as any; // Mock
    const arquivo = {
      nome: 'conta_luz.jpg',
      mime_type: 'image/jpeg',
      base64: 'aGVsbG8=',
    };
    const parts = (ChatIaService.prototype as any).montarPartesMensagem(
      'Analise esta conta de luz',
      arquivo,
    );
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({
      inlineData: { mimeType: 'image/jpeg', data: 'aGVsbG8=' },
    });
    expect(parts[1]).toEqual({ text: 'Analise esta conta de luz' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest apps/api/src/app/chat-ia/chat-ia.multimodal.spec.ts`
Expected: FAIL with "montarPartesMensagem is not a function"

- [ ] **Step 3: Implement minimal code in `chat-ia.service.ts` and `chat-ia.controller.ts`**

Adicionar método `montarPartesMensagem(texto: string, arquivo?: { mime_type: string; base64: string })` e repassar o arquivo recebido no controller para o service:

```typescript
// em chat-ia.service.ts
montarPartesMensagem(texto: string, arquivo?: { mime_type: string; base64: string }): any[] {
  const parts: any[] = [];
  if (arquivo && arquivo.base64 && arquivo.mime_type) {
    parts.push({
      inlineData: {
        mimeType: arquivo.mime_type,
        data: arquivo.base64,
      },
    });
  }
  if (texto) {
    parts.push({ text: texto });
  }
  return parts;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest apps/api/src/app/chat-ia/chat-ia.multimodal.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add click-cond-web/apps/api/src/app/chat-ia/
git commit -m "feat(api): add multimodal attachment support to chat-ia service"
```

---

### Task 2: Backend - Prompt do Sistema para Leitura de Faturas e Extração RAG

**Files:**
- Modify: `click-cond-web/apps/api/src/app/chat-ia/chat-ia.service.ts:900-980`
- Modify: `click-cond-web/apps/api/src/app/chat-ia/chat-ia.acoes.ts:330-360`
- Test: `click-cond-web/apps/api/src/app/chat-ia/chat-ia.faturas.spec.ts`

**Interfaces:**
- Consumes: `propor_conta_morador`
- Produces: Prompt especializado para visão/OCR de boletos e faturas com chamada automática da ferramenta `propor_conta_morador` com dados extraídos.

- [ ] **Step 1: Write the failing unit test**

```typescript
// click-cond-web/apps/api/src/app/chat-ia/chat-ia.faturas.spec.ts
import { FERRAMENTAS_ACAO } from './chat-ia.acoes';

describe('propor_conta_morador com código de barras/PIX', () => {
  it('deve aceitar linha_digitavel e codigo_pix no payload', async () => {
    const f = FERRAMENTAS_ACAO.find((x) => x.nome === 'propor_conta_morador')!;
    const res = await f.propor(
      {
        categoria: 'Luz',
        valor: 150.25,
        nome: 'Conta Enel - Agosto',
        data_vencimento: '2026-09-10',
        linha_digitavel: '836100000015025000000000000000000000',
        codigo_pix: '00020126580014br.gov.bcb.pix...',
      },
      { idUser: 1, idCondominio: 10, papel: 'Morador', staff: false, aptos: [101], prisma: {} as any, cartoes: [] },
    );
    expect(res.proposta).toBeDefined();
    expect(res.proposta?.payload?.linha_digitavel).toBe('836100000015025000000000000000000000');
    expect(res.proposta?.payload?.pix_copia_cola).toBe('00020126580014br.gov.bcb.pix...');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest apps/api/src/app/chat-ia/chat-ia.faturas.spec.ts`
Expected: FAIL with "linha_digitavel / pix_copia_cola not defined on payload"

- [ ] **Step 3: Update `chat-ia.acoes.ts` and system instruction in `chat-ia.service.ts`**

Adicionar propriedades opcionais `linha_digitavel` e `codigo_pix` nos parâmetros e payload de `propor_conta_morador`, e adicionar instruções claras no system prompt:
"Ao receber uma foto ou PDF de fatura/conta (Luz, Água, Gás, Internet, Aluguel), extraia automaticamente o nome do emissor/concessionária, a categoria correta, o valor total, a data de vencimento e a linha digitável / código de barras / PIX e chame `propor_conta_morador`."

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest apps/api/src/app/chat-ia/chat-ia.faturas.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add click-cond-web/apps/api/src/app/chat-ia/
git commit -m "feat(api): enhance propor_conta_morador with barcode and pix extraction"
```

---

### Task 3: Frontend - Atualização de `controller_generic.dart` para Envio de Anexos

**Files:**
- Modify: `click-cond-app/click-cond-app/lib/controllers/controller_generic.dart:495-530`
- Test: `click-cond-app/click-cond-app/test/chat_ia_controller_test.dart`

**Interfaces:**
- Consumes: `apiPerguntarChatIa`
- Produces: Suporte ao parâmetro `arquivo: Map<String, dynamic>?` (com `nome`, `mime_type`, `base64`) enviado no corpo da requisição POST para `/chat-ia/perguntar`.

- [ ] **Step 1: Write the failing unit test**

```dart
// test/chat_ia_controller_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:click/controllers/controller_generic.dart';

void main() {
  test('apiPerguntarChatIa aceita parametro arquivo opcional', () async {
    expect(
      () => apiPerguntarChatIa(
        'Analise minha conta',
        conversaId: '123',
        arquivo: {
          'nome': 'fatura.jpg',
          'mime_type': 'image/jpeg',
          'base64': 'dGVzdA==',
        },
      ),
      returnsNormally,
    );
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `flutter test test/chat_ia_controller_test.dart`
Expected: FAIL with "No named parameter with the name 'arquivo'"

- [ ] **Step 3: Implement minimal code in `controller_generic.dart`**

```dart
Future<RespostaIa> apiPerguntarChatIa(
  String pergunta, {
  String? conversaId,
  Map<String, dynamic>? arquivo,
}) async {
  final url = _buildUri('/chat-ia/perguntar');
  final body = json.encode({
    "id_condominio": Singleton.instance.id_condominio.toString(),
    "pergunta": pergunta,
    if (conversaId != null && conversaId.isNotEmpty) "conversa_id": conversaId,
    if (arquivo != null) "arquivo": arquivo,
  });
  // ... ApiClient.post
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `flutter test test/chat_ia_controller_test.dart`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add click-cond-app/click-cond-app/lib/controllers/controller_generic.dart
git commit -m "feat(app): support file attachments in apiPerguntarChatIa"
```

---

### Task 4: Frontend - Botão de Anexo, Menu de Captura e Preview Flutuante na `chat_ia_page.dart`

**Files:**
- Modify: `click-cond-app/click-cond-app/lib/pages/shared/chat_ia/chat_ia_page.dart:1030-1170`
- Test: `click-cond-app/click-cond-app/test/chat_ia_anexo_test.dart`

**Interfaces:**
- Consumes: `image_picker`, `file_picker`, `PhosphorIcons.paperclip`
- Produces: Botão de anexo no campo de entrada, bottom sheet com Câmera / Galeria / Arquivo, preview flutuante com botão de remoção e inclusão da miniatura na bolha da mensagem.

- [ ] **Step 1: Write the failing widget test**

```dart
// test/chat_ia_anexo_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:click/pages/shared/chat_ia/chat_ia_page.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

void main() {
  testWidgets('ChatIaPage exibe botão de anexo na barra inferior', (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: ChatIaPage(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byIcon(PhosphorIcons.paperclip), findsOneWidget);
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `flutter test test/chat_ia_anexo_test.dart`
Expected: FAIL with "Found 0 widgets with icon PhosphorIcons.paperclip"

- [ ] **Step 3: Implement minimal code in `chat_ia_page.dart`**

Adicionar:
1. Variáveis de estado `_anexoSelecionado` (`Map<String, dynamic>?` com `nome`, `mime_type`, `base64`, `caminhoLocal`).
2. Métodos `_selecionarFotoCamera()`, `_selecionarFotoGaleria()`, `_selecionarArquivoDocumento()`.
3. Widget `_buildAnexoPreview()` acima do TextField quando houver anexo.
4. Botão de anexo `IconButton(icon: Icon(PhosphorIcons.paperclip), ...)` à esquerda do TextField.
5. Inclusão da miniatura do anexo no widget `_buildBubble()` quando a mensagem possuir imagem/arquivo.
6. Envio do anexo em `_enviar()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `flutter test test/chat_ia_anexo_test.dart`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add click-cond-app/click-cond-app/lib/pages/shared/chat_ia/chat_ia_page.dart
git commit -m "feat(app): add attachment capture button and preview to chat ia"
```

---

### Task 5: Integração Completa e Validação End-to-End no Emulador

**Files:**
- Test / Verify: Executar fluxo no emulador Android
- Screenshot: Capturar imagem da barra com botão de anexo, modal de seleção, envio da fatura de energia e card de confirmação no Financeiro.

- [ ] **Step 1: Run all test suites**

Run: `flutter test`
Expected: All tests pass 100%.

- [ ] **Step 2: Build and deploy debug APK on emulator**

Run: `flutter build apk --debug && adb install -r build/app/outputs/flutter-apk/app-debug.apk`

- [ ] **Step 3: Test and capture screenshots**

Capture visual evidence of the attachment picker and confirmation card flow.
