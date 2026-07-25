const { createGlobPatternsForDependencies } = require('@nx/angular/tailwind');
const { join } = require('path');

/**
 * Design system "Mercury" — tema claro único do CRM.
 * Tokens semânticos consomem as CSS variables definidas em styles.css:
 * surface (fundos), ink (texto), line (bordas), accent (azul royal),
 * success/warning/danger/info (semânticas com variantes soft/border).
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
        // Tokens semânticos — fonte de verdade: CSS vars em styles.css
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
          600: '#1d4ed8',
          700: '#1e40af',
        },
        success: {
          DEFAULT: '#16a34a',
          soft: '#f0fdf4',
          border: '#bbf7d0',
        },
        warning: {
          DEFAULT: '#d97706',
          soft: '#fffbeb',
          border: '#fde68a',
        },
        danger: {
          DEFAULT: '#dc2626',
          soft: '#fef2f2',
          border: '#fecaca',
        },
        info: {
          DEFAULT: '#7c3aed',
          soft: '#f5f3ff',
          border: '#ddd6fe',
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
      },
    },
  },
  plugins: [],
};
