const { createGlobPatternsForDependencies } = require('@nx/angular/tailwind');
const { join } = require('path');

/**
 * Design system "Verdant" — adaptação do kit Paperpillar (Property Management
 * Dashboard) para o CRM. Superfícies claras sem borda, cards flutuantes de
 * canto largo, acento verde-escuro e uma paleta cromática fixa
 * (verde / bege / púrpura / tosca) usada em gráficos, tiles e badges.
 *
 * Os tokens semânticos (surface, ink, line, accent, success…) consomem as CSS
 * variables de styles.css — todo o markup deve usar os tokens, nunca hex.
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    join(__dirname, 'src/**/!(*.stories|*.spec).{ts,html}'),
    ...createGlobPatternsForDependencies(__dirname),
  ],
  theme: {
    extend: {
      colors: {
        // ── Tokens semânticos (fonte de verdade: CSS vars em styles.css) ──
        surface: {
          page: 'var(--surface-page)',
          raised: 'var(--surface-raised)',
          sunken: 'var(--surface-sunken)',
          contrast: 'var(--surface-contrast)',
          overlay: 'var(--surface-overlay)',
        },
        ink: {
          DEFAULT: 'var(--text-primary)',
          soft: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
          inverse: 'var(--text-inverse)',
        },
        line: {
          subtle: 'var(--border-subtle)',
          DEFAULT: 'var(--border-default)',
          strong: 'var(--border-strong)',
        },
        accent: {
          DEFAULT: '#4a6b52',
          soft: '#e8f1ea',
          border: '#cbe0d2',
          600: '#3f5c46',
          700: '#38571a',
        },
        success: { DEFAULT: '#3f7d51', soft: '#e8f4eb', border: '#c6e3cf' },
        warning: { DEFAULT: '#a97c2f', soft: '#faf2e2', border: '#ebdcbb' },
        danger: { DEFAULT: '#9c1c1c', soft: '#fbeded', border: '#f0cfcf' },
        info: { DEFAULT: '#5b6285', soft: '#eeeff5', border: '#d5d8e8' },

        // ── Paleta cromática do kit (gráficos, tiles, categorias) ──
        army: '#38571a',
        forest: { 300: '#4a6b52', 200: '#6e9179', 100: '#a8d0b3', 50: '#e8f1ea' },
        beige: { 300: '#b39c74', 200: '#e5d5b0', 50: '#f6efe0' },
        lilac: { 300: '#5b6285', 200: '#b7bcd9', 100: '#e7e7ec', 50: '#f2f2f7' },
        tosca: { DEFAULT: '#c5dfe1', 300: '#7fb0b4', 50: '#e9f4f5' },
        brick: '#9c1c1c',
      },
      fontFamily: {
        // General Sans é a face do kit; Inter cobre o corpo denso.
        sans: ['General Sans', 'Inter', 'system-ui', 'sans-serif'],
        display: ['General Sans', 'Inter', 'system-ui', 'sans-serif'],
        // "mono" aqui significa "numérico tabular", não monoespaçado técnico.
        mono: ['Plus Jakarta Sans', 'General Sans', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
        // Escala de display do kit (H1 32 · H2 36 · H3 24 · H4 20)
        'display-lg': ['2.25rem', { lineHeight: '1.15', letterSpacing: '-0.02em' }],
        'display-md': ['2rem', { lineHeight: '1.2', letterSpacing: '-0.02em' }],
        'display-sm': ['1.5rem', { lineHeight: '1.3', letterSpacing: '-0.015em' }],
        'display-xs': ['1.25rem', { lineHeight: '1.35', letterSpacing: '-0.01em' }],
      },
      borderRadius: {
        DEFAULT: '8px',
        md: '10px',
        lg: '12px',
        xl: '16px',
        '2xl': '20px',
        '3xl': '28px',
      },
      boxShadow: {
        // Elevação do kit: sombras largas e muito difusas, sem borda visível.
        card: '0 1px 2px rgba(24, 30, 24, 0.04), 0 10px 28px -18px rgba(24, 30, 24, 0.18)',
        pop: '0 4px 12px -4px rgba(24, 30, 24, 0.08), 0 18px 40px -20px rgba(24, 30, 24, 0.28)',
        rail: '0 8px 30px -14px rgba(24, 30, 24, 0.25)',
        modal: '0 32px 64px -16px rgba(24, 30, 24, 0.32)',
      },
      maxWidth: {
        shell: '1360px',
      },
    },
  },
  plugins: [],
};
