const { createGlobPatternsForDependencies } = require('@nx/angular/tailwind');
const { join } = require('path');

/**
 * Design system "Mercury" — tema claro único do CRM.
 * Tokens semânticos consomem as CSS variables definidas em styles.css:
 * surface (fundos), ink (texto), line (bordas), accent (azul royal),
 * success/warning/danger/info (semânticas com variantes soft/border).
 *
 * ATENÇÃO — PONTE DE COMPATIBILIDADE (remover na Fase 6 da migração):
 * as paletas legadas (graphite, accent-300/400, emerald-450/455, rose-*,
 * amber-*, zinc-150/350/450/550/555/650, border-zinc-250) são redefinidas
 * para valores claros para o markup antigo renderizar certo enquanto a
 * migração aba-a-aba para os tokens semânticos não termina.
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
          DEFAULT: '#2563eb',
          soft: '#eff6ff',
          border: '#bfdbfe',
          // legado: dourados/lime remapeados para o azul (ponte)
          300: '#2563eb',
          400: '#2563eb',
          500: '#2563eb',
          600: '#1d4ed8',
          700: '#1e40af',
        },
        success: {
          DEFAULT: '#16a34a',
          soft: '#f0fdf4',
          border: '#bbf7d0',
          400: '#16a34a',
          500: '#16a34a',
        },
        warning: {
          DEFAULT: '#d97706',
          soft: '#fffbeb',
          border: '#fde68a',
          400: '#d97706',
          500: '#d97706',
        },
        danger: {
          DEFAULT: '#dc2626',
          soft: '#fef2f2',
          border: '#fecaca',
          400: '#dc2626',
          500: '#dc2626',
        },
        info: {
          DEFAULT: '#7c3aed',
          soft: '#f5f3ff',
          border: '#ddd6fe',
        },
        // ── Ponte de compatibilidade (remover na Fase 6) ──
        graphite: {
          DEFAULT: '#f9f9fb',
          50: '#f4f4f5',
          100: '#f4f4f5',
          200: '#ffffff',
          300: '#e4e4e7',
          400: '#f9f9fb',
          900: '#f4f4f5',
        },
        emerald: { 450: '#16a34a', 455: '#16a34a' },
        rose: { 450: '#dc2626', 455: '#dc2626' },
        amber: { 450: '#d97706', 455: '#d97706' },
        zinc: {
          150: '#ececee',
          250: '#dcdce0',
          350: '#8e8e96',
          450: '#62626a',
          550: '#494950',
          555: '#494950',
          650: '#3f3f46',
        },
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        display: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        // Piso tipográfico do sistema: 11px para labels densas
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      borderRadius: {
        DEFAULT: '4px',
        md: '8px',
        lg: '8px',
        xl: '12px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(0, 0, 0, 0.05)',
        pop: '0 4px 16px -4px rgba(24, 24, 27, 0.10)',
        modal: '0 20px 50px -12px rgba(24, 24, 27, 0.25)',
        // legado (ponte): remapeados para sombras claras
        panel: '0 1px 2px rgba(0, 0, 0, 0.05)',
        glow: '0 4px 16px -4px rgba(37, 99, 235, 0.15)',
      },
    },
  },
  plugins: [],
};
