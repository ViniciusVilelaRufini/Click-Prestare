# Portaria-web: tema Prestare Dark

Aplica o design system **Prestare Dark** ao console web (`click-cond-web/apps/portaria-web`). Muda só a aparência: lógica, rotas, chamadas de API e textos ficam como estão.

## Fontes de verdade

Referências locais (fora do repo), em
`C:\Users\vinic\AppData\Local\Temp\claude\c--Users-vinic-Desktop-Click-with-Prestare\8c6e9927-88f3-46cd-9708-0c56d76a73e3\scratchpad\ref\`:

| Arquivo | Conteúdo |
|---|---|
| `design-system-README.md` | Princípios, tom, seção "Painel web (Web Console)" |
| `tokens.json` | Tokens exatos (cores, tipos, espaços, raios) |
| `mock.css` | CSS do protótipo do console: fonte das classes `ps-*` |
| `web-{login,dashboard,visitantes,encomendas}-{dark,light}.png` | Telas de referência |
| `prestare-icone-{branco,preto}.png` | Logo monocromática |

Havendo conflito: `tokens.json` > README > `mock.css` > PNGs.

Para a tipografia de tela grande do console, os tamanhos do `mock.css` prevalecem sobre `tokens.json` (`ps-h1` 30/32, ou 24/26 abaixo de 900px; `ps-num` 44/44).

## Fora de escopo

- `apps/crm-web`, `click-cond-app`, `click-cond-api`, pacotes em `packages/`.
- Páginas estáticas de `public/` (`/sobre`, `/sindico`, html legais estáticos).
- Dados de exemplo, eventos simulados e botões sem função que só existem no protótipo.
- Credenciais pré-preenchidas e o rodapé `prestaregestao.com.br` do protótipo: esse domínio é de outro sistema e não pode aparecer no console.

## Princípios obrigatórios

1. Fundo `bg-000`; cards `bg-200`; campos `bg-300` ou `bg-200` com borda; separação por divisor `line-100` de 1px; **sem sombras**.
2. Um primário sólido `accent`/`on-accent` por contexto; secundário em contorno `line-200`.
3. Barlow Condensed em maiúsculas para estrutura (títulos, abas, botões, rótulos, cabeçalho de tabela). Barlow em caixa normal para conteúdo. A caixa alta vem de CSS (`text-transform`), nunca alterando o texto no template.
4. Cor só sinaliza: `signal-*` apenas em ponto de 6px ou texto curto, nunca em fundo de card, badge ou botão. Nenhuma cor de marca nem azul.
5. Cantos retos: `radius-0` em botões, cards e campos; `radius-sm` (2px) em tags; `radius-round` só em avatares e pontos.
6. Ícones de traço 1.5px, sem ícone colorido.
7. Contraste 4.5:1 em texto e 3:1 em bordas de controle, nos dois temas.

## Arquitetura

### 1. Camada central

Remapear a paleta do Tailwind para tokens CSS faz os cerca de 20 mil usos de classes nos templates herdarem o tema sem edição arquivo a arquivo.

**Tokens em `src/styles.css`:** os nomes do design system (`--bg-000`, `--bg-100`, `--bg-200`, `--bg-300`, `--line-100`, `--line-200`, `--ink`, `--ink-muted`, `--ink-subtle`, `--accent`, `--on-accent`, `--accent-ghost`, `--signal-ok`, `--signal-warn`, `--signal-danger`, `--scrim`, `--grid`, `--font-display`, `--font-sans`), com os valores exatos de `tokens.json`/`mock.css`. Mais as variantes em canais RGB (`--c-ink: 255 255 255` etc.) para o Tailwind aplicar alfa. Escuro em `:root`; claro em `html.light`. As classes `html.light`/`html.dark` continuam sendo o mecanismo de tema (não usar `data-theme`).

**Tailwind (`tailwind.config.js`, v3.4):**

| Família | Mapeamento |
|---|---|
| `accent` (todas) | `--c-accent`; `accent-600/700` = tom de pressionado (dark `#d4d4d4`, light `#262626`) |
| `graphite` | `DEFAULT`, `900` → `bg-000`; `400` → `bg-100`; `200` → `bg-200`; `50`, `100` → `bg-300`; `300` → `line-100` |
| `slate`, `gray`, `zinc`, `neutral` em texto | `50-200`, `800-950` → `ink`; `300`, `400`, `600`, `700` → `ink-muted`; `500` → `ink-subtle` |
| as mesmas em fundo | `50` → `bg-100`; `100` → `bg-200`; `200`, `800` → `bg-300`; `300`, `700` → `line-200`; `900` → `bg-200`; `950` → `bg-100` |
| as mesmas em borda | `50-200` → `line-100`; `300+` → `line-100`, exceto controles via regra de base |
| `white` | texto → `ink`; borda e fundo com alfa → canal de `ink`; `bg-white` sólido → `bg-200` |
| `emerald`, `green`, `teal`, `lime` | `signal-ok` |
| `amber`, `yellow`, `orange` | `signal-warn` |
| `rose`, `red`, `pink` | `signal-danger` |
| `blue`, `indigo`, `sky`, `cyan`, `violet`, `purple`, `fuchsia` | `ink-muted` (monocromático) |
| `fontFamily` | `sans` Barlow; `display` Barlow Condensed; `mono` Barlow, com `tabular-nums` por regra |
| `borderRadius` | `none`..`3xl` = 0; `sm` = 2px; `full` = 999px |
| `boxShadow` | tudo `none` |

As paletas separadas por propriedade usam `theme.textColor`, `theme.backgroundColor` e `theme.borderColor`.

**Regras centrais em `styles.css`:**

- Elementos sobre `bg-accent` usam `on-accent`, inclusive descendentes `text-white` (senão fica branco no branco).
- Fundos translúcidos ou claros de sinal (`bg-emerald-500/10`, `bg-rose-50`, `bg-amber-500/15`…) viram transparente com borda `line-200`; o texto de sinal permanece.
- Botões sólidos: `button.bg-emerald-*` → primário `accent`; `button.bg-rose-*`/`bg-red-*` → contorno e texto `signal-danger`; `button.bg-amber-*` → secundário. Pontos sólidos que não são botão continuam com cor de sinal.
- `.rounded-full[class*="px-"]` (pílulas) → 2px; avatares e pontos seguem redondos.
- `th` → estilo `label`; `tr:hover` → `accent-ghost`; `svg[fill="none"]` com traço 1.5; foco com contorno `ink` (sem azul).
- `.bg-white` sobre QR e fotos: exceção por classe utilitária `qr-paper` (`#fff` nos dois temas).
- A remoção do escurecimento dos modais (seção 6 atual) é substituída por `--scrim`, como no design. As pilhas `.light .text-slate-*` com `!important` saem, pois os tokens já resolvem por tema.

### 2. Classes de componente `ps-*`

Em `@layer components`, portadas de `mock.css` com prefixo e sem seletores globais de elemento: `ps-label`, `ps-h1`, `ps-h2`, `ps-num`, `ps-cap`, `ps-btn` (`-sec`, `-ghost`, `-danger`, `-sm`, `-lg`), `ps-ibtn`, `ps-tag` (`-solid`), `ps-dot` (`-ok`, `-warn`, `-danger`, `-ink`, `-pulse`), `ps-seg`, `ps-seg-pill`, `ps-field`, `ps-kpis`, `ps-kpi`, `ps-panel`, `ps-panel-head`, `ps-phead`, `ps-tablewrap`, `ps-person`, `ps-avatar`, `ps-ico`, `ps-empty`, `ps-scrim`, `ps-drawer` (`-head`, `-body`, `-foot`), `ps-modal`, `ps-toast`, `ps-brand`.

### 3. Tema

O escuro é o padrão. Sem escolha salva, segue `prefers-color-scheme`. A escolha do botão sol/lua persiste em `prestare_theme` (`light`|`dark`). A troca automática por horário (`theme_phase`, intervalo de 10 s) sai. As chaves antigas são ignoradas, porque foram gravadas pelo automático e não indicam escolha do usuário. `index.html` e `ThemeService` aplicam a mesma regra.

### 4. Telas sob medida

Shell, sidebar, login e as telas Dashboard, Visitantes e Encomendas seguem os PNGs usando `ps-*`. Os demais módulos recebem ajustes residuais após auditoria visual.

### 5. Movimento

Sidebar e controle segmentado usam um indicador sólido que desliza, via diretiva compartilhada. Respeitar `prefers-reduced-motion`.

### 6. Responsivo

Abaixo de 900px a sidebar vira menu e as tabelas rolam na horizontal dentro do próprio quadro. A página nunca rola na horizontal.

## Critérios de aceite

- `npx nx build portaria-web` passa.
- `npx nx test portaria-web` sem nenhuma falha além das do baseline.
- Todas as rotas do console e públicas renderizam nos dois temas, em 1440px e 390px, sem azul residual, sombra, texto invisível ou rolagem horizontal da página.
- Nenhuma alteração em `public/sobre`, `public/sindico`, `apps/crm-web` ou lógica TS que não seja de tema.
