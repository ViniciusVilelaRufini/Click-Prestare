const { createGlobPatternsForDependencies } = require('@nx/angular/tailwind');
const { join } = require('path');

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
        // Tons de superfície — Slate/Navy Escuro Corporativo
        graphite: {
          DEFAULT: '#090D16', // Background principal do app (Dark)
          50:  '#252A33',
          100: '#1F2937',     // darkSurfaceElevated (Gray 800)
          200: '#111827',     // surface principal do app (Gray 900)
          300: '#1F2A3D',     // border
          400: '#13171D',
          900: '#060D18',
        },
        // Acento corporativo moderno (Royal Blue em vez de Ciano Neon)
        accent: {
          DEFAULT: '#2563EB',
          400: '#60A5FA',
          500: '#2563EB',
          600: '#1D4ED8',
          700: '#1E40AF',
        },
        // Alerta corporativo sóbrio
        warn: {
          DEFAULT: '#D97706',
          500: '#D97706',
          600: '#B45309',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        display: ['Plus Jakarta Sans', 'Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 1px 2px rgba(0,0,0,0.05), 0 4px 12px rgba(0,0,0,0.08)',
        card: '0 1px 3px rgba(0,0,0,0.02), 0 4px 16px rgba(0,0,0,0.04)',
      },
    },
  },
  plugins: [],
};
