# App — ajustes da varredura de design: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alinhar cinco telas do app (GERENCIAR do condomínio, Prestare IA, Notificações, Início, Editar perfil) ao padrão visual do resto do app, sem mudar fluxos.

**Architecture:** Mudanças locais de layout em widgets Flutter existentes. A única peça compartilhada nova é um modo `scrollable` no `AppSegmentedControl` (abas sublinhadas com largura natural e rolagem lateral), usado por Notificações.

**Tech Stack:** Flutter/Dart, `phosphor_flutter`, tokens em `lib/theme` (`AppColors`, `AppTypography`, `AppSpacing`).

**Spec:** `docs/superpowers/specs/2026-11-09-app-varredura-ajustes-design.md`

Raiz do app: `click-cond-app/click-cond-app/` (todos os caminhos abaixo são relativos a ela). Branch: `feat/app-atalhos` no worktree `C:\w\app-dark`.

## Global Constraints

- Sem mudar fluxos, navegação ou textos além dos citados no spec.
- Cores só por tokens (`AppColors.*`), nada de `Color(0x..)`/`Colors.grey`.
- Cantos retos (`AppRadius` = 0; só `tag` = 2).
- Não rodar `dart format` no arquivo inteiro (reformata tudo); formatar só o trecho mexido.
- Não commitar `ios/Runner/GeneratedPluginRegistrant.*` nem `last.txt`.
- Testes existentes continuam passando (exceto as 4 falhas antigas de Assembleias, que já falham no `master`).
- Cada tela conferida no emulador (Pixel_10) nos temas claro e escuro.

## Review Focus

1. Notificações com contadores grandes ("Comunicados (128)"): as abas não podem cortar texto nem estourar a largura; devem rolar.
2. Tema escuro: o novo cabeçalho da IA e o bloco GERENCIAR precisam de contraste (texto `textPrimary` sobre `bg`/`surface`), sem preto fixo.
3. Nome de módulo longo ("Funcionários do Condomínio") na lista compacta: uma linha com reticências, sem empurrar a seta.
4. Lista GERENCIAR do síndico (mais módulos que o morador): o separador não aparece depois da última linha.
5. Tela pequena (largura 320): o título "PRESTARE IA" não encosta nos botões.

---

### Task 1: Abas sublinhadas com rolagem (`AppSegmentedControl.scrollable`) + Notificações

**Files:**
- Modify: `lib/widgets/app/app_segmented_control.dart`
- Modify: `lib/pages/shared/notificacoes/notificacoes_page.dart:250-350` (filtros) e `:509-524` (seta do cartão)
- Test: `test/app_segmented_control_test.dart` (criar)

**Interfaces:**
- Produces: `const AppSegmentedControl({..., bool scrollable = false})`. Com `scrollable: true`, cada aba tem largura do próprio rótulo + respiro lateral 16, dentro de um `SingleChildScrollView` horizontal; sublinhado e cores iguais ao modo normal. Com `false`, comportamento atual inalterado.

- [ ] **Step 1: Testes que falham**

```dart
testWidgets('scrollable mostra rótulo inteiro com contador grande', (t) async {
  await t.pumpWidget(MaterialApp(home: Scaffold(body: SizedBox(width: 320,
    child: AppSegmentedControl(scrollable: true, selectedIndex: 0, onChanged: (_) {},
      segments: const [AppSegment(label: 'Todas', count: 128), AppSegment(label: 'Acessos', count: 12),
        AppSegment(label: 'Encomendas', count: 3), AppSegment(label: 'Comunicados', count: 128),
        AppSegment(label: 'Outros')])))));
  expect(t.takeException(), isNull);            // sem overflow
  expect(find.byType(SingleChildScrollView), findsOneWidget);
  await t.drag(find.byType(SingleChildScrollView), const Offset(-400, 0));
  await t.pumpAndSettle();
  await t.tap(find.textContaining('OUTROS'));
});
testWidgets('modo normal não rola', (t) async { /* 3 segmentos, scrollable omitido */
  // expect(find.byType(SingleChildScrollView), findsNothing);
});
```
(Conferir no `_SegmentItem` se o rótulo é exibido em caixa alta e ajustar o `find` ao texto real.)

- [ ] **Step 2:** `flutter test test/app_segmented_control_test.dart` → FAIL (parâmetro `scrollable` não existe).
- [ ] **Step 3:** Implementar `scrollable` no `AppSegmentedControl` (o `_SegmentItem` deixa de ser `Expanded` nesse modo).
- [ ] **Step 4:** Em `notificacoes_page.dart`, trocar o `SingleChildScrollView` de botões preenchidos por `AppSegmentedControl(scrollable: true, ...)` com os mesmos 5 filtros, `count: _countTipo(key)` só quando > 0, `selectedIndex` derivado de `_filtroSelecionado`. Trocar a seta em círculo (`Container` 28×28 `BoxShape.circle`) por `Icon(PhosphorIcons.caretRight, size: 16, color: AppColors.textTertiary(context))`, igual ao `_MenuRow`. Manter a barra lateral colorida.
- [ ] **Step 5:** `flutter test test/app_segmented_control_test.dart test/encomendas` → PASS.
- [ ] **Step 6:** Commit `feat(app): notificações com abas sublinhadas`.

### Task 2: GERENCIAR em lista compacta

**Files:**
- Modify: `lib/pages/shared/my_condominium.dart:486-515` (sliver do menu) e `:1569-1619` (`_MenuRow`)

**Interfaces:**
- Consumes: `_menu` (`List<_MenuItem>` com `icon`, `label`, `page`) e `_navigate(page)`, já existentes.

- [ ] **Step 1:** Trocar a `SliverList` com espaços de 8 por um único `Container` (fundo `AppColors.surface(context)`, borda `AppColors.border(context)`) contendo as linhas em `Column`; entre linhas, `Divider(height: 1, thickness: 1, indent: 16 + 32 + 12, color: AppColors.border(context))`; sem divisor depois da última. Manter o padding inferior 88 da sliver.
- [ ] **Step 2:** `_MenuRow` sem caixa própria: altura mínima 56, padding horizontal 16, ícone 32×32 em `brandSoftOf` sem borda (ícone 18, `brandInkOf`), espaço 12, nome `bodyMedium` w600 em 1 linha com reticências, seta 16 `textTertiary`.
- [ ] **Step 3:** `flutter analyze lib/pages/shared/my_condominium.dart` → sem novos avisos.
- [ ] **Step 4:** Conferir no emulador (morador e, se possível, síndico): 15 módulos, nome longo com reticências, sem divisor no fim, temas claro e escuro.
- [ ] **Step 5:** Commit `feat(app): módulos do condomínio em lista compacta`.

### Task 3: Cabeçalho e sugestões da Prestare IA

**Files:**
- Modify: `lib/pages/shared/chat_ia/chat_ia_page.dart:666-755` (`_buildTopBar`, `_acaoTopo`) e `:982-994` (sugestões)

- [ ] **Step 1:** `_buildTopBar`: remover o bloco `AppColors.primary`; fundo transparente sobre `bg`, borda inferior `border`; título "PRESTARE IA" com `AppTypography.title(context)` (mesmo do `AppScaffold`), mantendo `Stack` + `IgnorePointer` + padding 96 + `FittedBox`.
- [ ] **Step 2:** `_acaoTopo`: botão quadrado 36×36 com fundo `surface`, borda `border`, ícone 18 `textPrimary` (mesmo visual do `.iconbtn` em `list_condominiums.dart:_buildHeaderActions`). Corrigir o comentário que fala em "botão redondo".
- [ ] **Step 3:** Sugestões: `ActionChip` com `shape: const RoundedRectangleBorder()`, texto `AppTypography.caption(context).copyWith(color: AppColors.textPrimary(context))`, `side` com `AppColors.border(context)`.
- [ ] **Step 4:** `flutter test test/chat_ia_controller_test.dart test/chat_ia_anexo_test.dart` → PASS; conferir no emulador (claro/escuro, largura pequena).
- [ ] **Step 5:** Commit `feat(app): cabeçalho da Prestare IA no padrão das telas`.

### Task 4: Espaço do Início e rótulos do perfil

**Files:**
- Modify: `lib/pages/sindico/list_condominiums.dart:416-437` (início da lista após o cabeçalho)
- Modify: `lib/widgets/app/app_input.dart:95-104` (`floatingLabelStyle`)

- [ ] **Step 1:** Medir no emulador o vão entre o texto "MEUS CONDOMÍNIOS" e o topo do cartão (hoje ~42dp). Reduzir para 12dp, o mesmo vão entre a saudação e os atalhos, ajustando o `top: 12` da `SliverPadding` e qualquer margem interna do primeiro cartão.
- [ ] **Step 2:** `AppInput.floatingLabelStyle`: tamanho 12 com `letterSpacing: 12 * 0.16` (hoje herda 11 do `AppTypography.label`, menor que o rótulo em repouso de 13). Os rótulos "(Opcional)" já passam pelo mesmo `toUpperCase()`; conferir no emulador que "TELEFONE (OPCIONAL)" fica igual aos demais. Se o placeholder desigual vier de um `hint` próprio em `edit_morador.dart:236-245`, alinhar ao padrão dos outros campos.
- [ ] **Step 3:** `flutter test` (suite inteira) → só as 4 falhas antigas de Assembleias.
- [ ] **Step 4:** Commit `fix(app): espaço do início e rótulos dos campos`.

### Task 5: Verificação final

- [ ] **Step 1:** `flutter analyze` sem avisos novos em relação ao início da branch.
- [ ] **Step 2:** Build `flutter build apk --debug --target-platform android-x64`, instalar com `adb install -r`, e capturar as 5 telas nos temas claro e escuro em `C:\w\app-dark\.superpowers\varredura\depois\`.

### Task 6: Cartões dos módulos com imagem em degradê (Fase 2 do spec)

**Files:** `lib/pages/shared/my_condominium.dart` (`_MenuRow`, sliver do menu), `assets/images/modulos/*.png`, `test/my_condominium_menu_test.dart`, `test/modulos_icones_test.dart`

- [ ] **Step 1:** Gerar 3 amostras no Z Image (1:1) com o prompt-base; mostrar ao usuário; seguir só com o ok.
- [ ] **Step 2:** Teste `linha do módulo mostra o efeito do toque` (já escrito em my_condominium_menu_test.dart) → FAIL hoje.
- [ ] **Step 3:** Cartão por módulo: `Material(color: surface, shape: Border(border))` + `InkWell`; imagem 96dp de largura com `ShaderMask` (gradiente horizontal opaco→transparente a partir de ~45%); altura mínima 72; espaço 8 entre cartões.
- [ ] **Step 4:** Gerar os 15 restantes, salvar em `assets/images/modulos/<nome>.png` (mesmos nomes de hoje), conferir a prancha.
- [ ] **Step 5:** `flutter test test/my_condominium_menu_test.dart test/modulos_icones_test.dart` → PASS; conferir claro/escuro no emulador.
- [ ] **Step 6:** Commit.
