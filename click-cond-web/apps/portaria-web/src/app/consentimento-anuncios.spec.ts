import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const publico = (arquivo: string) =>
  readFileSync(join(process.cwd(), 'apps/portaria-web/public', arquivo), 'utf8');

const CHAVE = 'prestare-click:consentimento';

describe('tags de anúncio só com consentimento de marketing', () => {
  const tags = () => Array.from(document.head.querySelectorAll('script')).map((s) => s.src);

  function executar(): void {
    new Function(publico('consentimento-anuncios.js'))();
  }

  beforeEach(() => {
    localStorage.clear();
    document.head.innerHTML = '';
    delete (window as any).gtag;
    delete (window as any).oaiq;
    delete (window as any).dataLayer;
  });

  it.each(['sobre/index.html', 'sindico/index.html'])('%s não carrega tag direto na página', (pagina) => {
    const html = publico(pagina);
    expect(html).not.toContain('googletagmanager.com');
    expect(html).not.toContain('bzrcdn.openai.com');
    expect(html).toContain('<script src="/consentimento-anuncios.js" defer></script>');
  });

  it('sem escolha gravada, não carrega nada', () => {
    executar();
    expect(tags()).toEqual([]);
    expect((window as any).gtag).toBeUndefined();
  });

  it('com marketing recusado, não carrega nada', () => {
    localStorage.setItem(CHAVE, JSON.stringify({ analytics: true, marketing: false }));
    executar();
    expect(tags()).toEqual([]);
  });

  it('consentimento ilegível conta como recusa', () => {
    localStorage.setItem(CHAVE, '{quebrado');
    executar();
    expect(tags()).toEqual([]);
  });

  it('carrega as duas tags uma única vez depois do aceite', () => {
    executar();
    localStorage.setItem(CHAVE, JSON.stringify({ marketing: true }));
    (window as any).psAplicarConsentimento();
    (window as any).psAplicarConsentimento();
    expect(tags()).toHaveLength(2);
    expect(tags().join()).toContain('googletagmanager.com');
    expect(tags().join()).toContain('bzrcdn.openai.com');
  });
});
