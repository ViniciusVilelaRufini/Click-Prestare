import { readFileSync } from 'fs';
import { join } from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const config = require('../../../tailwind.config.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const resolveConfig = require('tailwindcss/resolveConfig');
const tema = resolveConfig(config).theme as Record<string, Record<string, any>>;
const CSS = readFileSync(join(__dirname, '../../styles.css'), 'utf8');

const TONS = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];
const FAMILIAS_ESCALA_COMPLETA = [
  'accent', 'slate', 'gray', 'zinc', 'neutral',
  'emerald', 'green', 'teal', 'lime',
  'amber', 'yellow', 'orange',
  'rose', 'red', 'pink',
  'blue', 'indigo', 'sky', 'cyan', 'violet', 'purple', 'fuchsia',
];
const TONS_GRAPHITE = ['DEFAULT', '50', '100', '200', '300', '400', '900'];
const NEUTRAS = ['slate', 'gray', 'zinc', 'neutral'];
const PROPRIEDADES = ['textColor', 'backgroundColor', 'borderColor'];

// Cópia de REF/tokens.json (o arquivo de referência fica fora do repositório).
const TOKENS: Record<string, { dark: string; light: string }> = {
  'bg-000': { dark: '#000000', light: '#ffffff' },
  'bg-100': { dark: '#0b0b0b', light: '#fafafa' },
  'bg-200': { dark: '#141414', light: '#f4f4f4' },
  'bg-300': { dark: '#1f1f1f', light: '#e9e9e9' },
  'line-100': { dark: '#242424', light: '#e2e2e2' },
  'line-200': { dark: '#666666', light: '#888888' },
  ink: { dark: '#ffffff', light: '#000000' },
  'ink-muted': { dark: '#a3a3a3', light: '#555555' },
  'ink-subtle': { dark: '#8a8a8a', light: '#6b6b6b' },
  accent: { dark: '#ffffff', light: '#000000' },
  'on-accent': { dark: '#000000', light: '#ffffff' },
  'accent-ghost': { dark: 'rgba(255, 255, 255, 0.08)', light: 'rgba(0, 0, 0, 0.05)' },
  'signal-ok': { dark: '#5ec28a', light: '#1a7a48' },
  'signal-warn': { dark: '#e3b04b', light: '#946000' },
  'signal-danger': { dark: '#ff6b6b', light: '#c42d33' },
  'qr-ink': { dark: '#000000', light: '#000000' },
  'qr-paper': { dark: '#ffffff', light: '#ffffff' },
};

// Tokens do protótipo (mock.css) e o tom de pressionado do spec, que não constam em tokens.json.
const TOKENS_EXTRAS: Record<string, { dark: string; light: string }> = {
  scrim: { dark: 'rgba(0, 0, 0, 0.65)', light: 'rgba(0, 0, 0, 0.35)' },
  grid: { dark: 'rgba(255, 255, 255, 0.045)', light: 'rgba(0, 0, 0, 0.05)' },
  'accent-press': { dark: '#d4d4d4', light: '#262626' },
};

function bloco(seletor: string): string {
  const inicio = CSS.search(new RegExp(`(^|\\n)${seletor}\\s*\\{`));
  if (inicio < 0) throw new Error(`styles.css sem o bloco ${seletor}`);
  return CSS.slice(inicio, CSS.indexOf('}', inicio));
}

function valorDe(blocoCss: string, nome: string): string | undefined {
  return blocoCss.match(new RegExp(`--${nome}:\\s*([^;]+);`))?.[1].trim();
}

const canais = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(' ');

describe('tema Prestare Dark: Tailwind', () => {
  describe.each(PROPRIEDADES)('%s', (propriedade) => {
    it.each(FAMILIAS_ESCALA_COMPLETA)('%s resolve para token em todos os tons', (familia) => {
      for (const tom of TONS) {
        expect(tema[propriedade][familia]?.[tom]).toContain('var(--');
      }
    });

    it('graphite resolve para token', () => {
      for (const tom of TONS_GRAPHITE) {
        expect(tema[propriedade]['graphite']?.[tom]).toContain('var(--');
      }
    });

    it('white resolve para o canal de ink', () => {
      expect(tema[propriedade]['white']).toContain('var(--c-ink)');
    });
  });

  it.each(NEUTRAS)('%s em texto segue a tabela do spec', (familia) => {
    const texto = tema['textColor'][familia];
    for (const tom of ['50', '100', '200', '800', '900', '950']) expect(texto[tom]).toContain('--c-ink)');
    for (const tom of ['300', '400', '600', '700']) expect(texto[tom]).toContain('--c-ink-muted)');
    expect(texto['500']).toContain('--c-ink-subtle)');
  });

  it.each(NEUTRAS)('%s em fundo segue a tabela do spec', (familia) => {
    const fundo = tema['backgroundColor'][familia];
    const esperado: Record<string, string> = {
      '50': 'bg-100', '100': 'bg-200', '200': 'bg-300', '800': 'bg-300',
      '300': 'line-200', '700': 'line-200', '900': 'bg-200', '950': 'bg-100',
    };
    for (const [tom, token] of Object.entries(esperado)) expect(fundo[tom]).toContain(`--c-${token})`);
  });

  it.each(NEUTRAS)('%s em borda usa line-100', (familia) => {
    for (const tom of TONS) expect(tema['borderColor'][familia][tom]).toContain('--c-line-100)');
  });

  it('graphite segue a tabela do spec', () => {
    const g = tema['backgroundColor']['graphite'];
    const esperado: Record<string, string> = {
      DEFAULT: 'bg-000', '900': 'bg-000', '400': 'bg-100', '200': 'bg-200',
      '50': 'bg-300', '100': 'bg-300', '300': 'line-100',
    };
    for (const [tom, token] of Object.entries(esperado)) expect(g[tom]).toContain(`--c-${token})`);
  });

  it('accent 600 e 700 usam o tom de pressionado', () => {
    for (const propriedade of PROPRIEDADES) {
      expect(tema[propriedade]['accent']['DEFAULT']).toContain('--c-accent)');
      expect(tema[propriedade]['accent']['500']).toContain('--c-accent)');
      expect(tema[propriedade]['accent']['600']).toContain('--c-accent-press)');
      expect(tema[propriedade]['accent']['700']).toContain('--c-accent-press)');
    }
  });

  it.each([
    ['signal-ok', ['emerald', 'green', 'teal', 'lime']],
    ['signal-warn', ['amber', 'yellow', 'orange']],
    ['signal-danger', ['rose', 'red', 'pink']],
    ['ink-muted', ['blue', 'indigo', 'sky', 'cyan', 'violet', 'purple', 'fuchsia']],
  ])('%s cobre as famílias mapeadas', (token, familias) => {
    for (const familia of familias) {
      for (const propriedade of PROPRIEDADES) {
        expect(tema[propriedade][familia]['500']).toContain(`--c-${token})`);
      }
    }
  });

  it('cantos: zero de none a 3xl, sm 2px, full 999px', () => {
    for (const k of ['none', 'DEFAULT', 'md', 'lg', 'xl', '2xl', '3xl']) {
      expect(parseFloat(tema['borderRadius'][k])).toBe(0);
    }
    expect(tema['borderRadius']['sm']).toBe('2px');
    expect(tema['borderRadius']['full']).toBe('999px');
  });

  it('sem nenhuma sombra', () => {
    expect(tema['boxShadow']['lg']).toBe('none');
    for (const valor of Object.values(tema['boxShadow'])) expect(valor).toBe('none');
  });

  it('fontes: Barlow e Barlow Condensed, sem Inter ou Plus Jakarta', () => {
    expect(tema['fontFamily']['sans'][0]).toBe('Barlow');
    expect(tema['fontFamily']['mono'][0]).toBe('Barlow');
    expect(tema['fontFamily']['display'][0]).toBe('Barlow Condensed');
    expect(JSON.stringify(tema['fontFamily'])).not.toMatch(/Inter|Jakarta/);
  });
});

describe('tema Prestare Dark: styles.css', () => {
  let escuro = '';
  let claro = '';
  beforeAll(() => {
    escuro = bloco(':root');
    claro = bloco('html\.light');
  });

  it.each(Object.keys(TOKENS))('--%s tem os valores exatos de tokens.json nos dois temas', (nome) => {
    expect(valorDe(escuro, nome)).toBe(TOKENS[nome].dark);
    expect(valorDe(claro, nome)).toBe(TOKENS[nome].light);
  });

  it.each(Object.keys(TOKENS_EXTRAS))('--%s existe nos dois temas', (nome) => {
    expect(valorDe(escuro, nome)).toBe(TOKENS_EXTRAS[nome].dark);
    expect(valorDe(claro, nome)).toBe(TOKENS_EXTRAS[nome].light);
  });

  it('famílias tipográficas vêm de tokens.json', () => {
    expect(valorDe(escuro, 'font-display')).toBe('"Barlow Condensed", "D-DIN Condensed", "Arial Narrow", sans-serif');
    expect(valorDe(escuro, 'font-sans')).toBe('"Barlow", "D-DIN", system-ui, sans-serif');
  });

  it('todo canal RGB corresponde ao hex do token, nos dois temas', () => {
    const comCanal = [
      'bg-000', 'bg-100', 'bg-200', 'bg-300', 'line-100', 'line-200', 'ink', 'ink-muted', 'ink-subtle',
      'accent', 'on-accent', 'signal-ok', 'signal-warn', 'signal-danger', 'accent-press',
    ];
    for (const nome of comCanal) {
      expect(valorDe(escuro, `c-${nome}`)).toBe(canais(valorDe(escuro, nome) as string));
      expect(valorDe(claro, `c-${nome}`)).toBe(canais(valorDe(claro, nome) as string));
    }
  });

  it('importa Barlow e Barlow Condensed, sem fontes antigas nem azul', () => {
    expect(CSS).toContain(
      '@import url("https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@300;400;500;600&family=Barlow:wght@400;500;600&display=swap");',
    );
    expect(CSS).not.toMatch(/Inter\b|Plus Jakarta/);
    expect(CSS).not.toMatch(/#2563EB|37, 99, 235/i);
  });

  it('preserva as regras estruturais e os chips de inadimplência', () => {
    expect(CSS).toMatch(/router-outlet\s*\{\s*display:\s*none;/);
    expect(CSS).toMatch(/app-root,[\s\S]*?display:\s*block;/);
    expect(CSS).toMatch(/\.inadimplente-chip:focus-visible\s*\{[^}]*var\(--ink\)/);
  });

  it('sai o que o spec manda sair', () => {
    expect(CSS).not.toMatch(/\.light \.text-slate-/);
    expect(CSS).not.toContain('background-color: transparent !important;\n  backdrop-filter');
    expect(CSS).toMatch(/\.qr-paper\s*\{[^}]*#fff/);
    expect(CSS).toContain('prefers-reduced-motion');
  });

  it.each([
    'ps-label', 'ps-h1', 'ps-h2', 'ps-num', 'ps-cap',
    'ps-btn', 'ps-btn-sec', 'ps-btn-ghost', 'ps-btn-danger', 'ps-btn-sm', 'ps-btn-lg', 'ps-ibtn',
    'ps-tag', 'ps-tag-solid',
    'ps-dot', 'ps-dot-ok', 'ps-dot-warn', 'ps-dot-danger', 'ps-dot-ink', 'ps-dot-pulse',
    'ps-seg', 'ps-seg-pill', 'ps-field', 'ps-kpis', 'ps-kpi', 'ps-panel', 'ps-panel-head', 'ps-phead',
    'ps-tablewrap', 'ps-person', 'ps-avatar', 'ps-ico', 'ps-empty', 'ps-scrim',
    'ps-drawer', 'ps-drawer-head', 'ps-drawer-body', 'ps-drawer-foot',
    'ps-modal', 'ps-toast', 'ps-brand',
  ])('define .%s dentro de @layer components', (classe) => {
    const camada = CSS.slice(CSS.indexOf('@layer components'));
    expect(camada).toMatch(new RegExp(`\\.${classe}(?![\\w-])`));
  });

  describe('tipografia de tela grande do console (valores de mock.css)', () => {
    const regra = (seletor: string, css = CSS) => {
      const inicio = css.indexOf(`${seletor} {`);
      if (inicio < 0) throw new Error(`styles.css sem a regra ${seletor}`);
      return css.slice(inicio, css.indexOf('}', inicio));
    };

    it('ps-h1 é 30/32 com .08em em maiúsculas', () => {
      const h1 = regra('.ps-h1');
      expect(h1).toContain('font-size: 30px');
      expect(h1).toContain('line-height: 32px');
      expect(h1).toContain('letter-spacing: 0.08em');
      expect(h1).toContain('font-weight: 600');
      expect(h1).toContain('text-transform: uppercase');
    });

    it('ps-num é peso 300 em 44/44', () => {
      const num = regra('.ps-num');
      expect(num).toContain('font-size: 44px');
      expect(num).toContain('line-height: 44px');
      expect(num).toContain('font-weight: 300');
    });

    it('abaixo de 900px ps-h1 e o h1 do shell ficam em 24/26', () => {
      const blocos = [...CSS.matchAll(/@media \(max-width: 899\.98px\) \{([\s\S]*?)\n\s*\}\r?\n/g)].map((m) => m[1]);
      for (const seletor of ['.ps-h1', 'app-shell main h1']) {
        const bloco = blocos.find((b) => b.includes(`${seletor} {`));
        expect(bloco).toBeDefined();
        expect(regra(seletor, bloco)).toMatch(/font-size: 24px/);
        expect(regra(seletor, bloco)).toMatch(/line-height: 26px/);
      }
    });

    it('h1 só recebe o estilo dentro do shell', () => {
      const h1 = regra('app-shell main h1');
      expect(h1).toContain('var(--font-display)');
      expect(h1).toContain('font-size: 30px');
      expect(h1).toContain('line-height: 32px');
      expect(h1).toContain('letter-spacing: 0.08em');
      expect(h1).toContain('text-transform: uppercase');
      expect(CSS).not.toMatch(/(^|\n|,\s*)h1\s*(,|\{)/);
    });
  });

  describe('caixa alta central em botões de texto', () => {
    const inicio = () => CSS.indexOf('/* Botões de texto');
    const secao = () => CSS.slice(inicio(), CSS.indexOf('{', CSS.indexOf(':is(button, a)', inicio())));
    const regraDosBotoes = () => {
      const abre = CSS.indexOf('{', CSS.indexOf(':is(button, a)', inicio()));
      return CSS.slice(abre, CSS.indexOf('}', abre));
    };

    it('usa Barlow Condensed 600, maiúsculas, .16em e 12px', () => {
      expect(regraDosBotoes()).toContain('font-family: var(--font-display)');
      expect(regraDosBotoes()).toContain('font-weight: 600');
      expect(regraDosBotoes()).toContain('text-transform: uppercase');
      expect(regraDosBotoes()).toContain('letter-spacing: 0.16em');
      expect(regraDosBotoes()).toMatch(/font-size: var\(--ps-btn-texto, 12px\)/);
    });

    it.each(['bg-accent', 'bg-emerald-500', 'bg-rose-600', 'bg-amber-500', 'bg-red-500', 'border'])(
      'cobre [class~="%s"]',
      (classe) => expect(secao()).toContain(`[class~="${classe}"]`),
    );

    it.each(['text-left', 'justify-between', 'flex-col', 'p-2', 'w-8', 'border-transparent'])(
      'exclui [class~="%s"]',
      (classe) => expect(secao()).toContain(`[class~="${classe}"]`),
    );

    it('não alcança a sidebar, as classes ps-* nem cards com bloco de texto', () => {
      expect(secao()).toContain('app-sidebar *');
      expect(secao()).toContain('[class*="ps-"]');
      expect(secao()).toContain(':has(> [class~="text-left"])');
    });

    it('não cita classes com ponto, que gerariam variantes no Tailwind', () => {
      expect(secao()).not.toMatch(/\.(bg|border|text|flex|justify)-/);
    });

    it.each(['9', '10', '11'])('botão compacto de %spx mantém o tamanho', (px) => {
      expect(CSS.replace(/\s+/g, ' ')).toContain(`:is(button, a)[class~="text-[${px}px]"] { --ps-btn-texto: ${px}px;`);
    });
  });

  it('não porta seletores globais de elemento do protótipo', () => {
    expect(CSS).not.toMatch(/(^|\n)table\s*\{/);
    expect(CSS).not.toMatch(/(^|\n)td\s*\{/);
    expect(CSS).not.toMatch(/overflow:\s*hidden;?\s*transition:\s*background/);
  });
});
