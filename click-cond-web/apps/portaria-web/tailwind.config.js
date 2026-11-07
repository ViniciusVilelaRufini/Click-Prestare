const { createGlobPatternsForDependencies } = require('@nx/angular/tailwind');
const { join } = require('path');
const plugin = require('tailwindcss/plugin');

// Tema Prestare Dark: toda a paleta usada nos templates resolve para os tokens de
// src/styles.css. Os templates herdam o tema sem edição, inclusive o modificador
// de alfa (`bg-white/5`), por isso os tokens ficam em canais RGB (`--c-*`).
const tok = (nome) => `rgb(var(--c-${nome}) / <alpha-value>)`;

const TONS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const escala = (tokenDoTom) => Object.fromEntries(TONS.map((t) => [t, tok(tokenDoTom(t))]));
const familias = (nomes, tokenDoTom) =>
  Object.fromEntries(nomes.map((n) => [n, escala(tokenDoTom)]));

const NEUTRAS = ['slate', 'gray', 'zinc', 'neutral'];
const SINAIS = {
  'signal-ok': ['emerald', 'green', 'teal', 'lime'],
  'signal-warn': ['amber', 'yellow', 'orange'],
  'signal-danger': ['rose', 'red', 'pink'],
};
const FRIAS = ['blue', 'indigo', 'sky', 'cyan', 'violet', 'purple', 'fuchsia'];

const textoNeutro = (t) => {
  if (t <= 200 || t >= 800) return 'ink';
  return t === 500 ? 'ink-subtle' : 'ink-muted';
};
// 400 a 600 não constam no spec: são cinzas médios, como 300 e 700.
const fundoNeutro = (t) =>
  ({ 50: 'bg-100', 100: 'bg-200', 200: 'bg-300', 800: 'bg-300', 900: 'bg-200', 950: 'bg-100' })[t] ??
  'line-200';

const graphite = {
  DEFAULT: tok('bg-000'),
  50: tok('bg-300'),
  100: tok('bg-300'),
  200: tok('bg-200'),
  300: tok('line-100'),
  400: tok('bg-100'),
  900: tok('bg-000'),
};

const accent = {
  DEFAULT: tok('accent'),
  ...escala(() => 'accent'),
  600: tok('accent-press'),
  700: tok('accent-press'),
  // Usados em poucos templates; antes não geravam CSS.
  light: tok('accent'),
  dark: tok('accent-press'),
};

const colors = {
  inherit: 'inherit',
  current: 'currentColor',
  transparent: 'transparent',
  black: '#000',
  white: tok('ink'),
  accent,
  graphite,
  ...familias(NEUTRAS, textoNeutro),
  ...Object.assign({}, ...Object.entries(SINAIS).map(([token, nomes]) => familias(nomes, () => token))),
  ...familias(FRIAS, () => 'ink-muted'),
};

// Regras que dependem da família de cor e por isso são geradas aqui: cor só sinaliza em
// ponto ou texto curto, nunca em fundo de badge, card ou botão. O !important vence as
// variantes dark: e hover: dos templates.
const SOLIDOS = [400, 500, 600];
const emToken = (prefixo) => `[class^="${prefixo}"],[class*=" ${prefixo}"]`;
// Por atributo, e não por classe: o Tailwind repetiria a regra para cada variante hover:/dark: de uma classe citada aqui.
const solidos = (f) => SOLIDOS.map((t) => `[class~="bg-${f}-${t}"]`).join(',');
const bordaDeControle = {
  'border-width': '1px !important',
  'border-style': 'solid !important',
  'border-color': 'var(--line-200) !important',
};

function regrasDeCor({ addBase }) {
  const todas = [...Object.values(SINAIS).flat(), ...FRIAS];

  // Fundos translúcidos ou claros (`bg-rose-50`, `bg-rose-500/10`, `dark:bg-rose-950/40`).
  const translucidos = todas.flatMap((f) => [
    `:is(${emToken(`bg-${f}-`)}):not(${solidos(f)})`,
    `html[class~="dark"] :is(${emToken(`dark:bg-${f}-`)})`,
  ]);
  addBase({
    [translucidos.join(',')]: { 'background-color': 'transparent !important' },
    [translucidos.map((s) => `${s}:not(:empty)`).join(',')]: bordaDeControle,
    // Hover colorido vira o realce neutro.
    [todas.map((f) => `[class*="hover:bg-${f}-"]:hover`).join(',')]: {
      'background-color': 'var(--accent-ghost) !important',
    },
  });

  // Sólido com conteúdo (badge, ícone) perde o fundo; sólido vazio é ponto e segue colorido.
  for (const [token, nomes] of [...Object.entries(SINAIS), ['ink-muted', FRIAS]]) {
    const seletor = `:is(${nomes.map(solidos).join(',')}):not(:empty):not(button,a)`;
    addBase({
      [seletor]: { 'background-color': 'transparent !important', ...bordaDeControle },
      [`${seletor},${seletor} *`]: { color: `var(--${token}) !important` },
    });
  }

  // Botões sólidos: primário, perigo em contorno e os demais como secundário.
  const botao = (nomes) => `:is(button,a):is(${nomes.map(solidos).join(',')})`;
  const primario = botao(SINAIS['signal-ok']);
  const perigo = botao(SINAIS['signal-danger']);
  const secundario = botao([...SINAIS['signal-warn'], ...FRIAS]);
  addBase({
    [primario]: {
      'background-color': 'var(--brand) !important',
      'border-color': 'var(--brand) !important',
    },
    [`${primario},${primario} *`]: { color: 'var(--on-brand) !important' },
    [`${primario}:hover`]: { opacity: '0.86' },
    [perigo]: {
      'background-color': 'transparent !important',
      ...bordaDeControle,
      'border-color': 'var(--signal-danger) !important',
    },
    [`${perigo},${perigo} *`]: { color: 'var(--signal-danger) !important' },
    [secundario]: { 'background-color': 'transparent !important', ...bordaDeControle },
    [`${secundario},${secundario} *`]: { color: 'var(--ink) !important' },
  });
}

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    join(__dirname, 'src/**/!(*.stories|*.spec).{ts,html}'),
    ...createGlobPatternsForDependencies(__dirname),
  ],
  darkMode: 'class',
  theme: {
    colors,
    backgroundColor: { ...colors, ...familias(NEUTRAS, fundoNeutro) },
    borderColor: {
      ...colors,
      DEFAULT: 'var(--line-100)',
      ...familias(NEUTRAS, () => 'line-100'),
    },
    fontFamily: {
      sans: ['Barlow', 'D-DIN', 'system-ui', 'sans-serif'],
      display: ['Barlow Condensed', 'D-DIN Condensed', 'Arial Narrow', 'sans-serif'],
      mono: ['Barlow', 'D-DIN', 'system-ui', 'sans-serif'],
    },
    borderRadius: {
      none: '0',
      sm: '2px',
      DEFAULT: '0',
      md: '0',
      lg: '0',
      xl: '0',
      '2xl': '0',
      '3xl': '0',
      full: '999px',
    },
    boxShadow: {
      sm: 'none',
      DEFAULT: 'none',
      md: 'none',
      lg: 'none',
      xl: 'none',
      '2xl': 'none',
      inner: 'none',
      none: 'none',
    },
    extend: {
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-in-right': {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.15s ease-out',
        'slide-in-right': 'slide-in-right 0.25s ease-out',
      },
    },
  },
  plugins: [plugin(regrasDeCor)],
};
