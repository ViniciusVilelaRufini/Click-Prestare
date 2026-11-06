# Plano: tema Prestare Dark no app Flutter

**Worktree:** `C:\w\app-dark`, branch `feat/app-prestare-dark`. **App (`APP`):** `click-cond-app/click-cond-app`.

**Comandos (a partir de `C:\w\app-dark\click-cond-app\click-cond-app`):** `flutter pub get`, `flutter analyze --no-fatal-infos`, `flutter test`.

**Referências (`REF`):** `C:\Users\vinic\AppData\Local\Temp\claude\c--Users-vinic-Desktop-Click-with-Prestare\8c6e9927-88f3-46cd-9708-0c56d76a73e3\scratchpad\ref-app\`
- `mock.css`: tokens e componentes do protótipo do app.
- `Prestare Gestão-appdrck.html`, em `C:\Users\vinic\Downloads`: protótipo com as 8 telas. Leia as funções de render no `<script>` para ver a estrutura; ignore o base64 do logo.
- `C:\Users\vinic\AppData\Local\Temp\claude\c--Users-vinic-Desktop-Click-with-Prestare\8c6e9927-88f3-46cd-9708-0c56d76a73e3\scratchpad\ref\design-system-README.md` e `tokens.json`: regras e tokens.

## Global Constraints

- Só `APP/lib`, `APP/test`, `APP/pubspec.*` e `APP/assets` mudam. Backend e web, não.
- Sem mudança de comportamento: chamadas de API, navegação, validação, permissões e texto visível ficam iguais. A chave de tradução não muda. Caixa alta só por estilo de apresentação (`toUpperCase()` no ponto de exibição de título/rótulo/botão), nunca alterando as traduções.
- Tema escuro: `bg-000 #000000`, `bg-100 #0b0b0b`, `bg-200 #141414`, `bg-300 #1f1f1f`, `line-100 #242424`, `line-200 #666666`, `ink #ffffff`, `ink-muted #a3a3a3`, `ink-subtle #8a8a8a`, `accent #ffffff`, `on-accent #000000`, `accent-ghost rgba(255,255,255,.08)`, `signal-ok #5ec28a`, `signal-warn #e3b04b`, `signal-danger #ff6b6b`.
- Tema claro: `bg-000 #ffffff`, `bg-100 #fafafa`, `bg-200 #f4f4f4`, `bg-300 #e9e9e9`, `line-100 #e2e2e2`, `line-200 #888888`, `ink #000000`, `ink-muted #555555`, `ink-subtle #6b6b6b`, `accent #000000`, `on-accent #ffffff`, `accent-ghost rgba(0,0,0,.05)`, `signal-ok #1a7a48`, `signal-warn #946000`, `signal-danger #c42d33`. QR: sempre preto sobre branco.
- Tipografia: Barlow Condensed em maiúsculas para estrutura (títulos 22/26 +0.1em, seção 15/20 +0.16em, rótulo 11/14 +0.2em, numeral peso 300 34/36); Barlow para conteúdo (16/22 peso 500, 14/20, 12/16). Via `google_fonts`, como hoje.
- Cor só sinaliza (ponto de 6px ou texto curto); nada de azul, gradiente, sombra ou elevação. Cantos retos, 2px em tags, redondo só em avatar e ponto. Ícones de traço fino, sem cor decorativa.
- Um primário por tela: sólido `accent` com texto `on-accent`. Secundário em contorno `line-200`.
- Tema padrão continua seguindo o sistema, com a troca manual existente.
- Não rode o app nem use o emulador: o controlador faz isso. Valide com `flutter analyze` e `flutter test`. Não deixe processos em segundo plano. Sem push.
- Commits em português, prefixo `style(app):` ou `feat(app):`, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage só de caminhos explícitos.

## Task 1: Fundação do tema

**Arquivos:** `lib/theme/*`, `lib/main.dart`, `lib/widgets/**`, testes em `test/theme/`.

1. `AppColors` com os tokens acima. `primary`, `primaryDark`, `primaryLight`, `info` e os gradientes deixam de ser azuis e passam a depender do tema. Como `AppColors.primary` é `const` e usado 739 vezes sem `BuildContext`, transforme em getter que lê o brilho atual (`ThemeController`, resolvendo `system` por `PlatformDispatcher.instance.platformBrightness`). Remova `const` nos pontos onde o compilador acusar. Acrescente `AppColors.onPrimary` e helpers contextuais para os demais tokens. Mantenha os nomes existentes (`surface`, `border`, `textPrimary`...) mapeados para `bg-200`, `line-100`, `ink`...
2. **Texto sobre primário:** todo `Colors.white` usado como texto ou ícone sobre fundo `AppColors.primary` vira `AppColors.onPrimary` no app inteiro. Enumere com grep e revise cada um; esse é o maior risco (branco sobre branco).
3. `AppTypography` e `AppTheme`: Barlow e Barlow Condensed, `ThemeData` para botões, campos, cartões, abas, diálogos, sheets e snackbar com cantos retos, sem elevação nem sombra, e `splash` discreto. Barra de navegação inferior e widgets em `lib/widgets/**` conforme `mock.css` (`.nav`, `.btn`, `.tag`, `.card`, `.list`, `.item`, `.ico`, `.avatar`, `.kpis`, `.sheet`, `.toast`). Mude `ThemeController` só se necessário ao getter.
4. Teste: `AppColors.primary`/`onPrimary` em cada brilho; contraste de `onPrimary` sobre `primary`.

## Task 2: Autenticação e Início

**Arquivos:** `lib/pages/auth/**`, `lib/pages/perfil_choice.dart`, a tela inicial do morador e do síndico (localize por `router.dart`). Siga as telas Login e Início do protótipo.

## Task 3: Financeiro, Encomendas e Visitantes

**Arquivos:** `lib/pages/shared/financeiro/**`, `lib/pages/shared/encomendas/**`, `lib/pages/shared/visitantes/**`, células correspondentes em `lib/widgets/cells/`. Siga as telas do protótipo.

## Task 4: Código de acesso, Condomínio e Solicitações

**Arquivos:** tela do QR de acesso (QR preto sobre branco nos dois temas), `lib/pages/shared/my_condominium.dart`, `lib/pages/sindico/**`, `lib/pages/shared/morador/**`, solicitações. Siga as telas do protótipo.

## Task 5: Restante do app

**Arquivos:** todo o restante de `lib/pages/**` e `lib/widgets/**`: troca de `Color(0x...)`, `Colors.<cor>`, `BorderRadius.circular`, `BoxShadow`, gradientes e `GoogleFonts.poppins` por tokens. Ao final, grep em `lib` lista só o que for justificado (QR, overlay de câmera, avatar, ponto).
