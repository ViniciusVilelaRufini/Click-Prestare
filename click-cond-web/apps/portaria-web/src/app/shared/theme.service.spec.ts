import { readFileSync } from 'fs';
import { join } from 'path';
import { ThemeService } from './theme.service';

const INDEX_HTML = readFileSync(join(__dirname, '../../index.html'), 'utf8');

function scriptDeTema(): string {
  const scripts = [...INDEX_HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const script = scripts.find((s) => s.includes('prestare_theme'));
  if (!script) throw new Error('index.html sem script inline de tema');
  return script;
}

function sistema(tema: 'dark' | 'light' | 'sem-preferencia'): void {
  window.matchMedia = jest.fn((query: string) => ({
    matches: query === `(prefers-color-scheme: ${tema})`,
  })) as unknown as typeof window.matchMedia;
}

const temaAplicado = () => ({
  light: document.documentElement.classList.contains('light'),
  dark: document.documentElement.classList.contains('dark'),
});

const aplicadores: [string, () => void][] = [
  ['ThemeService', () => void new ThemeService()],
  ['script inline do index.html', () => new Function(scriptDeTema())()],
];

describe('tema: regra de escolha inicial', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    document.body.className = '';
  });

  describe.each(aplicadores)('%s', (_nome, aplicar) => {
    it('sem escolha e sistema escuro aplica dark', () => {
      sistema('dark');
      aplicar();
      expect(temaAplicado()).toEqual({ light: false, dark: true });
    });

    it('sem escolha e sistema claro aplica light', () => {
      sistema('light');
      aplicar();
      expect(temaAplicado()).toEqual({ light: true, dark: false });
    });

    it('sem escolha e sem preferencia do sistema aplica dark', () => {
      sistema('sem-preferencia');
      aplicar();
      expect(temaAplicado()).toEqual({ light: false, dark: true });
    });

    it('prestare_theme salvo vence o sistema', () => {
      sistema('dark');
      localStorage.setItem('prestare_theme', 'light');
      aplicar();
      expect(temaAplicado()).toEqual({ light: true, dark: false });

      document.documentElement.className = '';
      sistema('light');
      localStorage.setItem('prestare_theme', 'dark');
      aplicar();
      expect(temaAplicado()).toEqual({ light: false, dark: true });
    });

    it('theme_mode e theme_phase antigos sao ignorados e nao sao regravados', () => {
      sistema('dark');
      localStorage.setItem('theme_mode', 'light');
      localStorage.setItem('theme_phase', 'day');
      aplicar();
      expect(temaAplicado()).toEqual({ light: false, dark: true });
      expect(localStorage.getItem('theme_mode')).toBe('light');
      expect(localStorage.getItem('theme_phase')).toBe('day');
    });

    it('nao grava escolha quando o usuario nao escolheu', () => {
      sistema('light');
      aplicar();
      expect(localStorage.getItem('prestare_theme')).toBeNull();
    });
  });

  it('o script inline aplica a classe no body ao carregar o DOM', () => {
    sistema('light');
    new Function(scriptDeTema())();
    window.dispatchEvent(new Event('DOMContentLoaded'));
    expect(document.body.classList.contains('light')).toBe(true);
    expect(document.body.classList.contains('dark')).toBe(false);
  });

  it('o script de tema vem antes do corpo e os demais scripts inline seguem no index.html', () => {
    expect(INDEX_HTML.indexOf('prestare_theme')).toBeLessThan(INDEX_HTML.indexOf('<body'));
    expect(INDEX_HTML).toContain('/sindico/index.html');
    expect(INDEX_HTML).toContain('clickprestarecondominios');
    expect(INDEX_HTML).not.toContain('theme_phase');
  });
});

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    document.body.className = '';
    sistema('dark');
  });

  afterEach(() => jest.restoreAllMocks());

  it('toggleTheme alterna o tema e grava prestare_theme', () => {
    const service = new ThemeService();
    expect(service.isLight()).toBe(false);

    service.toggleTheme();
    expect(service.isLight()).toBe(true);
    expect(temaAplicado()).toEqual({ light: true, dark: false });
    expect(document.body.classList.contains('light')).toBe(true);
    expect(localStorage.getItem('prestare_theme')).toBe('light');

    service.toggleTheme();
    expect(service.isLight()).toBe(false);
    expect(temaAplicado()).toEqual({ light: false, dark: true });
    expect(localStorage.getItem('prestare_theme')).toBe('dark');
  });

  it('toggleTheme nao toca nas chaves antigas', () => {
    const service = new ThemeService();
    service.toggleTheme();
    expect(localStorage.getItem('theme_mode')).toBeNull();
    expect(localStorage.getItem('theme_phase')).toBeNull();
  });

  it('nao agenda nenhum setInterval', () => {
    const espiao = jest.spyOn(window, 'setInterval');
    const espiaoGlobal = jest.spyOn(globalThis, 'setInterval');
    new ThemeService();
    expect(espiao).not.toHaveBeenCalled();
    expect(espiaoGlobal).not.toHaveBeenCalled();
  });

  it('funciona em ambiente sem matchMedia, caindo no escuro', () => {
    (window as unknown as { matchMedia?: unknown }).matchMedia = undefined;
    const service = new ThemeService();
    expect(service.isLight()).toBe(false);
    expect(temaAplicado()).toEqual({ light: false, dark: true });
  });
});
