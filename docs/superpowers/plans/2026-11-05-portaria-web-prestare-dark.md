# Plano: tema Prestare Dark na portaria-web

**Spec:** `docs/superpowers/specs/2026-11-05-portaria-web-prestare-dark-design.md` (leia antes de qualquer tarefa)

**Worktree:** `C:\w\web-dark` — branch `feat/portaria-web-prestare-dark`. O `node_modules` de `click-cond-web` é uma junção; nunca rode install.

**App:** `click-cond-web/apps/portaria-web` (abreviado `APP`).

**Comandos (a partir de `C:\w\web-dark\click-cond-web`):**
- `npx nx build portaria-web`
- `npx nx test portaria-web` (arquivo específico: `npx nx test portaria-web --testFile=<nome>`)

**Referências:** `C:\Users\vinic\AppData\Local\Temp\claude\c--Users-vinic-Desktop-Click-with-Prestare\8c6e9927-88f3-46cd-9708-0c56d76a73e3\scratchpad\ref\` (`REF`).

**Harness de QA:** `C:\Users\vinic\AppData\Local\Temp\claude\c--Users-vinic-Desktop-Click-with-Prestare\8c6e9927-88f3-46cd-9708-0c56d76a73e3\scratchpad\qa\` (`QA`), criado na Task 1, fora do repo.

## Global Constraints

- Só `APP` muda, além dos docs. Nunca tocar `apps/crm-web`, `click-cond-app`, `click-cond-api`, `packages/`, `APP/public/sobre`, `APP/public/sindico`.
- Sem mudança de comportamento: nenhuma alteração em lógica TS, chamada de API, `(click)`, `[(ngModel)]`, `@if`/`@for`, validação ou texto visível. Permitido: atributos `class`/`[class.x]`/`[ngClass]`, strings de classe no TS, estilos, estrutura de wrappers quando necessária ao layout. Toda ligação Angular de um elemento movido segue intacta.
- Caixa alta só via CSS. Testes existentes que leem texto ou seletor devem continuar passando sem edição; se um spec depender de classe alterada, atualize só o seletor e registre no report.
- Valores de cor sempre via token/classe do tema. Nenhum hex novo em template, exceto `qr-paper`.
- Proibido: azul, gradiente colorido, glow/blur decorativo, sombra, cantos arredondados fora de avatar/ponto, fundo colorido de sinal.
- Não copiar dados de exemplo, credenciais nem o domínio `prestaregestao.com.br` do protótipo.
- Manter o selo Powered by AWS do login.
- Commits pequenos, em português, com o prefixo `style(portaria-web):` ou `feat(portaria-web):`. Terminar a mensagem com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Não fazer push.
- Baseline de testes: `C:\Users\vinic\AppData\Local\Temp\claude\c--Users-vinic-Desktop-Click-with-Prestare\8c6e9927-88f3-46cd-9708-0c56d76a73e3\scratchpad\baseline-test.log` (2 suítes e 5 testes já falham, entre eles `sindico-landing.spec.ts`). Falha que já consta ali não é regressão.

## Task 1: Harness de QA

Crie, em `QA` (fora do repo):

1. `api-stub.mjs`: servidor Node sem dependências na porta 3000, atendendo `/api/*` do proxy (`APP/proxy.conf.json`). Leia os `*.service.ts` de dashboard, visitantes, encomendas, moradores, prestadores, apartamentos, veículos, ocorrências, comunicados, delivery, áreas sociais, assembleias, financeiro, documentos, terminais faciais e relatórios, e devolva fixtures com o formato real e dados fictícios (pelo menos 5 linhas por lista, cobrindo os status principais). Rota desconhecida responde `[]` com 200. O login aceita qualquer senha. Socket.IO pode falhar em silêncio.
2. `README.md`: como subir stub e `npx nx serve portaria-web --port 4300`, e qual conteúdo de `localStorage` (consulte `auth.service.ts`) abre o console logado.
3. `routes.txt`: todas as rotas do `app.routes.ts` com URL navegável.

**Verificação:** com o stub de pé, abra `/dashboard`, `/visitantes` e `/encomendas` via ferramentas do Playwright (`mcp__playwright__*`, carregáveis por ToolSearch) e confirme dados na tela, com screenshot. Encerre os processos ao terminar. Nada de QA entra no git; nenhum commit nesta tarefa, exceto se precisar corrigir docs.

## Task 2: Camada central do tema

**Arquivos:** `APP/tailwind.config.js`, `APP/src/styles.css`, `APP/src/index.html`, `APP/src/app/shared/theme.service.ts`, `APP/public/prestare-icone-branco.png`, `APP/public/prestare-icone-preto.png` (copiar de `REF`). Testes: `APP/src/app/shared/theme.service.spec.ts`, `APP/src/app/shared/prestare-dark-tema.spec.ts`.

Implemente as seções "Camada central", "Classes de componente `ps-*`" e "Tema" do spec.

1. TDD de `ThemeService`: sem escolha + sistema escuro → dark; sem escolha + sistema claro → light; `prestare_theme` salvo vence o sistema; `theme_mode`/`theme_phase` antigos são ignorados; `toggleTheme` grava `prestare_theme`; nenhum `setInterval`. O script inline de `index.html` aplica a mesma regra e define a classe antes do primeiro paint. Preserve os outros scripts inline e metas de `index.html`.
2. TDD de `prestare-dark-tema.spec.ts`: com `tailwindcss/resolveConfig` sobre o config, verifica que todas as famílias e tons (`accent`, `graphite`, `slate`, `gray`, `zinc`, `neutral`, `emerald`, `green`, `teal`, `lime`, `amber`, `yellow`, `orange`, `rose`, `red`, `pink`, `blue`, `indigo`, `sky`, `cyan`, `violet`, `purple`, `fuchsia`) em `textColor`, `backgroundColor` e `borderColor` resolvem para valores com `var(--`, que `borderRadius.xl` é zero, `full` é `999px` e `boxShadow.lg` é `none`. O teste também lê `styles.css` e verifica que todos os valores de `REF/tokens.json` para os dois temas estão presentes.
3. Enumere com grep todas as famílias de cor e todos os valores arbitrários (`bg-[#...]`, `text-[#...]`, `rgba(`) em `APP/src/app`. Mapeie toda família presente. Liste no report os literais que ficam para as tarefas de tela.
4. Substitua o `@import` de fontes por Barlow e Barlow Condensed (URL de `REF/bundle.css`). Remova Inter e Plus Jakarta. Ajuste as regras legadas conforme o spec; preserve `router-outlet { display:none }`, `app-root…{display:block}` e os chips de inadimplência (`.inadimplente-chip`, foco sem azul).
5. Porte as classes `ps-*` de `REF/mock.css` com prefixo. Inclua `prefers-reduced-motion`. Não porte seletores globais de elemento (`table`, `td`, `body{overflow:hidden}`).

**Verificação:** build e testes passam; com o harness, screenshot de `/login` e `/dashboard` nos dois temas sem azul e sem texto invisível (layout antigo ainda é esperado).

## Task 3: Shell, sidebar e componentes compartilhados

**Arquivos:** `APP/src/app/shell/shell.component.ts`, `shell/sidebar.component.{html,ts}`, `shared/page-header.component.ts`, `shared/stat-pill.component.ts`, `shared/confirm-host.component.ts`, `shared/toast-host.component.ts`, `shared/network-banner.component.ts`, novo `shared/slide-indicator.directive.ts` com spec.

Referência: `REF/web-dashboard-dark.png` e `-light.png`, README seção "Painel web".

- Sidebar `bg-100`, 248px, divisor `line-100`. Marca com logo (`prestare-icone-branco.png` no escuro, `-preto` no claro), "PRESTARE **GESTÃO**" (peso 300 em Gestão) e rótulo `Web console`. Grupos em `ps-label`; item 34px com ícone 17px; ativo em bloco sólido `accent` com texto `on-accent`, com indicador que desliza. Contadores à direita apenas se o componente já tiver os dados. Rodapé com avatar, nome, papel, botões de tema e sair, mantendo as ações existentes.
- Topbar mobile abaixo de 900px com botão de menu; sidebar como painel deslizante sobre `--scrim`. Ajuste os breakpoints do shell de `md` para `900px` com `min-[900px]:`.
- `slide-indicator.directive.ts`: diretiva standalone `psSlideIndicator` com entrada de eixo (`y` para sidebar, `x` para segmentado). Posiciona o elemento filho indicador no item com a classe `on` (ou `aria-current`/classe configurável) e reposiciona a cada mudança de estado e resize. Teste com spec.
- `page-header`: mesmas entradas; layout `ps-phead`, título `ps-h1`, subtítulo `ink-muted`, conteúdo projetado à direita, divisor abaixo. Ícone de cabeçalho sem caixa colorida (ou omitido).
- `stat-pill`: mesmas entradas; visual de `ps-kpi`, número `ps-num` com zero à esquerda via CSS/pipe apenas na apresentação. As entradas `iconBg`/`iconColor` seguem aceitas, sem cor de fundo.
- Toast sólido `accent` no canto inferior direito; confirm em `ps-modal` sobre `ps-scrim`; banner de rede sem hex literal.

**Verificação:** build, testes e screenshots do shell em 1440px e 390px nos dois temas comparados aos PNGs. Liste no report qualquer diferença deliberada.

## Task 4: Login e telas públicas

**Arquivos:** `APP/src/app/auth/login-page.component.ts`, `auth/redefinir-senha-page.component.ts`, `auth/selecionar-condominio.component.ts`, `convite/convite-page.component.ts`, `legal/politica-privacidade.component.ts`, `legal/exclusao-conta.component.ts`.

Referência: `REF/web-login-dark.png` e `-light.png`, seção `.login` de `REF/mock.css`.

Login em duas colunas iguais: esquerda com grade `--grid` e máscara em degradê, marca, tag, título grande em Barlow Condensed com a segunda parte em peso 300 e `ink-muted`, recursos com ícone de check, rodapé; direita com formulário de até 420px, botão de tema no canto, campos `ps-field`, primário `lg`, separador e botão secundário. Abaixo de 900px empilha. Mantenha **todos** os estados do login atual (MFA, erros, carregamento, QR, Powered by AWS, redefinição) e seus textos; remova glows e grade antiga. Use os textos atuais do componente, nunca os do protótipo. O rodapé só traz o que já existe. As demais telas usam a mesma linguagem: painel `ps-panel` centrado, sem glow.

**Verificação:** `login-mfa.spec`, `redefinir-senha-page.component.spec`, `convite-page.component.spec` e demais; screenshots nos dois temas em 1440 e 390, inclusive o estado de erro e de MFA.

## Task 5: Dashboard

**Arquivos:** `APP/src/app/dashboard/dashboard-page.component.{html,ts}` (TS só em strings de classe).

Referência: `REF/web-dashboard-{dark,light}.png`, classes `.kpis`, `.panel`, `.ev`, `.info`, `.quick`, `.clockbox`.

Cabeçalho com título, tag de status e relógio se já existirem os dados; faixa de 4 KPIs colados por divisor 1px com número `ps-num`; duas colunas (eventos à esquerda, painéis à direita, 380px) quebrando em 1180px; filtros em `ps-seg` com `psSlideIndicator`; eventos como linhas com tag + ponto; acesso rápido em grade de divisores. Modais existentes: formulário em `ps-drawer`, confirmação em `ps-modal`, preservando todas as ligações. Status por ponto + texto curto.

**Verificação:** todos os `dashboard-page.*.spec` e screenshots nos dois temas, em 1440 e 390, com modais abertos.

## Task 6: Visitantes

**Arquivos:** `APP/src/app/visitantes/visitantes-page.component.{html,ts}` (TS só em strings de classe).

Referência: `REF/web-visitantes-{dark,light}.png`, classes `.tools`, `.tablewrap`, `.person`, `.doc`, `.acts`.

Faixa de KPIs; barra de ferramentas com `ps-seg`, busca `ps-field`, botão atualizar; tabela em `ps-tablewrap` com rolagem horizontal interna, cabeçalho `ps-label`, sem zebra, hover `accent-ghost`; avatar + nome em `ps-person`; uma ação principal `ps-btn-sm` por linha e o resto em `ps-ibtn`; status em `ps-tag` + `ps-dot`. Formulários em `ps-drawer`; PIN e confirmações em `ps-modal`. O arquivo tem 3400 linhas: trabalhe por blocos e commite por bloco. Verifique QR, fotos e captura facial: fundo de QR com `qr-paper`.

**Verificação:** specs de visitantes e screenshots nos dois temas, em 1440 e 390, com formulário e PIN abertos.

## Task 7: Encomendas

**Arquivos:** `APP/src/app/encomendas/encomendas-page.component.{html,ts}` (TS só em strings de classe e hex literais trocados por token).

Referência: `REF/web-encomendas-{dark,light}.png`, classes `.legend`, `.chk`, `.bulk`.

KPIs; legenda de tempo de armazenamento (até 3 dias neutro, 3 a 6 `signal-warn`, 7+ `signal-danger`, sempre ponto e texto curto, usando os dados e limites já calculados pelo componente; se o limite atual diferir, mantenha o atual e registre no report); `ps-seg`, busca, filtro; tabela com checkbox `.chk` e barra de ação em massa se a função já existir; `Receber encomenda` em `ps-drawer`.

**Verificação:** specs de encomendas e screenshots nos dois temas, em 1440 e 390, com drawer aberto.

## Task 8: Módulos de cadastro

**Arquivos:** `APP/src/app/{prestadores,moradores,apartamentos,veiculos}/**` (templates e strings de classe).

Para cada rota: abra com o harness nos dois temas, em 1440 e 390, com modais abertos. Corrija apenas o que a camada central não resolveu: cabeçalho inline → `app-page-header`/`ps-phead`; cards/tabelas → `ps-panel`/`ps-tablewrap`; abas → `ps-seg`; badges → `ps-tag` + `ps-dot`; literais de cor; contraste. Modal de formulário → `ps-drawer` quando a troca for só de classes; caso contrário mantenha `ps-modal` e registre.

**Verificação:** specs dos módulos; report com a lista de rota × tema × viewport verificada.

## Task 9: Módulos operacionais

**Arquivos:** `APP/src/app/{ocorrencias,comunicados,delivery,areas-sociais,assembleias}/**`.

Mesmo processo e critérios da Task 8.

**Verificação:** specs dos módulos; report com a lista de rota × tema × viewport verificada.

## Task 10: Gestão e configuração

**Arquivos:** `APP/src/app/{financeiro,documentos,configuracoes,terminais-faciais,relatorios}/**`, `shared/facial-capture.component.ts`, `shared/enroll-capture.component.ts`.

Mesmo processo e critérios da Task 8. `terminais-faciais` e captura facial têm hex literais: troque por token, exceto overlay de vídeo, que pode manter branco/preto fixo por legibilidade sobre imagem. Gráficos em `relatorios`/`financeiro`: séries em tons de `ink`, com sinal só onde o significado for ok/alerta/erro.

**Verificação:** specs dos módulos; report com a lista de rota × tema × viewport verificada.

## Task 11: Auditoria final

1. Grep em `APP/src/app`, excluindo specs: `#[0-9a-fA-F]{6}`, `rgba(`, `shadow-`, `blur-`, `bg-gradient`, `Inter`, `Jakarta`, `prestaregestao`, `2563EB`. Classifique cada ocorrência, corrija as indevidas e remova do `tailwind` e do `styles.css` o que ficou sem uso.
2. Com o harness, percorra `QA/routes.txt` em 4 combinações (escuro/claro × 1440/390). Em cada uma, execute no browser um script que: detecta rolagem horizontal da página (`scrollWidth > innerWidth`); calcula o contraste de todo texto visível contra o fundo efetivo e lista o que fica abaixo de 4.5:1 (3:1 a partir de 24px); lista `box-shadow` não nulo e `border-radius` > 2px em elementos que não sejam avatar/ponto; lista cor de fundo saturada em área maior que 12×12px. Corrija o que encontrar.
3. Confirme que `git diff --stat master` só toca `APP` e `docs/superpowers`, que `npx nx build portaria-web` passa e que `npx nx test portaria-web` não piora o baseline.

**Verificação:** report com a tabela de achados e correções, e os comandos finais com saída.
