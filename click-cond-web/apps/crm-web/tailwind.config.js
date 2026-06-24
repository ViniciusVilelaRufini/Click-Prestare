const { createGlobPatternsForDependencies } = require('@nx/angular/tailwind');
const { join } = require('path');

/**
 * Sistema de design do CRM — baseado na skill "Dashboard Design System"
 * (dark, cloud-platform à la Heroku/Vercel/GitHub; grids modulares, painéis
 * glass, hierarquia de dados forte). Tokens: IBM Plex Sans, primary #0C5CAB,
 * surface #09090b, success/warning/danger, grid 8pt, raios 4/8px.
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    join(__dirname, 'src/**/!(*.stories|*.spec).{ts,html}'),
    ...createGlobPatternsForDependencies(__dirname),
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Acento primário do sistema (Warm pastel orange/gold)
        accent: {
          DEFAULT: '#F2884B',
          300: '#F2E530', // Lime/soft bright yellow
          400: '#E7D181', // Gold/sand yellow
          500: '#F2884B', // Warm pastel orange
          600: '#d9743c',
          700: '#bf6230',
        },
        // Superfícies baseados em #0A1207 (Netsuite dark forest)
        graphite: {
          DEFAULT: '#0A1207',
          50: '#23321f',
          100: '#1a2717',
          200: '#111d0e', // elevated pane
          300: '#2d3b2a', // border
          400: '#070c05',
          900: '#020401',
        },
        // Cores semânticas pastosas
        success: { DEFAULT: '#6bd396', 400: '#85e5ad', 500: '#6bd396' },
        warning: { DEFAULT: '#e8be6b', 400: '#f0d193', 500: '#e8be6b' },
        danger: { DEFAULT: '#f27b7b', 400: '#f69b9b', 500: '#f27b7b' },
        // Fallbacks para classes literais no HTML
        emerald: {
          450: '#6bd396',
          455: '#6bd396',
          500: '#6bd396',
        },
        rose: {
          450: '#f27b7b',
          455: '#f27b7b',
          500: '#f27b7b',
        },
        amber: {
          450: '#e8be6b',
          455: '#e8be6b',
          500: '#e8be6b',
        },
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        display: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        // Escala da skill: 12/14/16/20/24/32 (+ 11px para labels densas)
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      borderRadius: {
        // Raios da skill: sm 4px, md 8px
        DEFAULT: '4px',
        md: '8px',
        lg: '8px',
        xl: '12px',
      },
      boxShadow: {
        panel: '0 1px 2px rgba(0,0,0,0.4), 0 8px 24px -12px rgba(0,0,0,0.6)',
        glow: '0 0 0 1px rgba(12,92,171,0.35), 0 8px 30px -10px rgba(12,92,171,0.35)',
      },
      keyframes: {
        'fade-in': { '0%': { opacity: '0', transform: 'translateY(4px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        'slide-in-right': { '0%': { transform: 'translateX(100%)' }, '100%': { transform: 'translateX(0)' } },
        // Entrada em cascata: sobe + revela (usar com --i para delay incremental)
        'stagger-rise': { '0%': { opacity: '0', transform: 'translateY(10px) scale(0.985)' }, '100%': { opacity: '1', transform: 'translateY(0) scale(1)' } },
        // "Pop" sutil ao atualizar um número (count-up)
        'count-pop': { '0%': { transform: 'translateY(2px)', opacity: '0.4' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
        // Faixa de luz para skeletons
        'shimmer': { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
        // Toast entra/sai pela direita
        'toast-in': { '0%': { opacity: '0', transform: 'translateX(40px) scale(0.96)' }, '100%': { opacity: '1', transform: 'translateX(0) scale(1)' } },
        'toast-out': { '0%': { opacity: '1', transform: 'translateX(0)' }, '100%': { opacity: '0', transform: 'translateX(40px) scale(0.96)' } },
        // Flash de sucesso (linha liquidada, save confirmado)
        'flash-success': { '0%, 100%': { backgroundColor: 'transparent' }, '35%': { backgroundColor: 'rgba(107,211,150,0.16)' } },
        // Highlight de nova entrada em listas/logs
        'row-highlight': { '0%': { backgroundColor: 'rgba(242,136,75,0.14)' }, '100%': { backgroundColor: 'transparent' } },
        // Reveal de campos dependentes (toggles)
        'reveal-down': { '0%': { opacity: '0', transform: 'translateY(-6px)', maxHeight: '0' }, '100%': { opacity: '1', transform: 'translateY(0)', maxHeight: '600px' } },
      },
      animation: {
        'fade-in': 'fade-in 0.2s ease-out',
        'slide-in-right': 'slide-in-right 0.25s ease-out',
        'stagger-rise': 'stagger-rise 0.45s cubic-bezier(0.22,1,0.36,1) both',
        'count-pop': 'count-pop 0.35s cubic-bezier(0.22,1,0.36,1)',
        'shimmer': 'shimmer 1.6s ease-in-out infinite',
        'toast-in': 'toast-in 0.32s cubic-bezier(0.22,1,0.36,1) both',
        'toast-out': 'toast-out 0.28s ease-in both',
        'flash-success': 'flash-success 1.1s ease-out',
        'row-highlight': 'row-highlight 1.6s ease-out',
        'reveal-down': 'reveal-down 0.3s ease-out both',
      },
    },
  },
  plugins: [],
};
