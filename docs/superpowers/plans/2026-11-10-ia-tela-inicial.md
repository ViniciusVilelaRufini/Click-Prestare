# Prestare IA — tela inicial: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganizar a tela vazia da Prestare IA em cabeçalho compacto, grade 2x2 "FAÇA POR MIM" e lista "PERGUNTE", no visual de moldura amarela.

**Architecture:** Só `lib/pages/shared/chat_ia/chat_ia_page.dart` (`_buildEmptyState` e helpers). Ações e perguntas por perfil num getter; toque reaproveita `_enviar(texto)` e `_abrirMenuAnexo()`.

**Tech Stack:** Flutter.

**Spec:** `docs/superpowers/specs/2026-11-10-ia-tela-inicial-design.md`

## Global Constraints
- Cores por tokens (`AppColors.*`), cantos retos, moldura = borda `AppColors.brand` 1,5px com ícone `textPrimary`.
- Textos exatos do spec (títulos, apoios, "FAÇA POR MIM", "PERGUNTE", "Pergunte ou peça para eu resolver.").
- Pedidos enviados: "Quero reservar uma área social", "Quero abrir uma ocorrência", "Quero liberar um visitante", "Quero criar um comunicado", "Quero agendar uma manutenção programada", "Quero agendar uma mudança".
- Cabe em 320dp sem overflow; altura mínima, nunca fixa.

## Review Focus
1. Texto da pergunta longa quebra linha, nunca cortado (teste atual de RichText continua valendo).
2. Tela estreita (320) e fonte grande: grade 2x2 sem estouro.
3. Síndico vê as 4 ações de síndico; morador/funcionário as 4 do morador.
4. "Ler conta" abre o menu de anexo, não envia texto.
5. Tema escuro: moldura e textos legíveis.

---

### Task 1: Tela inicial da IA

**Files:** Modify `click-cond-app/click-cond-app/lib/pages/shared/chat_ia/chat_ia_page.dart`; Test `click-cond-app/click-cond-app/test/chat_ia_visual_test.dart`.

- [ ] **Step 1: Testes (falham)** em `chat_ia_visual_test.dart` (substituem os de degradê/cartões de sugestão):
  - `find.text('FAÇA POR MIM')` e `find.text('PERGUNTE')` existem.
  - morador: `find.byKey(ValueKey('ia-acao'))` → 4; textos 'RESERVAR', 'ABRIR', 'LIBERAR', 'LER CONTA'.
  - `find.byKey(ValueKey('ia-pergunta'))` → 3; nenhum `ShaderMask` na tela vazia.
  - ícone ✦ do topo dentro de `Container` com `Border` cor `AppColors.brand`.
  - tocar 'LER CONTA' mostra 'ANEXAR CONTA / FATURA' (menu de anexo).
  - 320dp: sem exceção; pergunta longa sem `didExceedMaxLines` e sem glifo além da largura (teste existente adaptado para `ia-pergunta`).
  - botão de enviar quadrado amarelo (teste existente mantido).
- [ ] **Step 2:** `flutter test test/chat_ia_visual_test.dart` → FAIL.
- [ ] **Step 3:** Implementar no `_buildEmptyState`: cabeçalho (Row: moldura 44 com ✦, Column título/subtítulo); seção "FAÇA POR MIM" com 2 `Row`s de 2 cartões `Expanded` (Material surface + borda; moldura 36 com ícone; título caixa alta + apoio; `InkWell` → `_enviar(pedido)` ou `_abrirMenuAnexo()`); seção "PERGUNTE" num bloco único com `Divider` entre linhas. Ações por perfil: síndico usa as de síndico; demais, as do morador. Remover `_cartaoSugestao`/`_degradeMarca` se ficarem sem uso.
- [ ] **Step 4:** testes da IA (`chat_ia_visual_test`, `chat_ia_anexo_test`, `chat_ia_controller_test`) → PASS; `flutter test` só com as 4 falhas antigas de Assembleias.
- [ ] **Step 5:** Commit `feat(app): tela inicial da Prestare IA com ações e perguntas`.
- [ ] **Step 6:** Conferir no emulador (claro e escuro).
