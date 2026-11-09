import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const pub = (p: string) => join(process.cwd(), 'apps/portaria-web/public', p);

// A /sobre/ chega pronta do servidor e /sobre/pagina.js só mantém as partes
// dinâmicas. Um erro de sintaxe ali não quebra o build: a página carrega, mas
// o simulador, os formulários e o aviso de cookies param.
describe('lógica da landing /sobre', () => {
  const codigo = () => readFileSync(pub('sobre/pagina.js'), 'utf8');

  function pagina(): any {
    const raiz: any = { __psSemIniciar: true };
    new Function('window', codigo())(raiz);
    return new raiz.PsPagina();
  }

  it('compila sem erro de sintaxe e sem React', () => {
    expect(() => new Function(codigo())).not.toThrow();
    expect(codigo()).not.toMatch(/React\.|DCLogic/);
  });

  it('o HTML não depende de runtime de terceiro nem de marcadores', () => {
    const html = readFileSync(pub('sobre/index.html'), 'utf8');
    expect(html).not.toContain('{{');
    expect(html).not.toContain('unpkg.com');
    expect(html).not.toContain('support.js');
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).toContain('<script src="/sobre/pagina.js" defer></script>');
  });

  it('o HTML já traz os valores que a lógica calcula', () => {
    const html = readFileSync(pub('sobre/index.html'), 'utf8');
    const v = pagina().renderVals();
    expect(html).toContain(`<div class="plan" data-t="simPlano">${v.simPlano}</div>`);
    expect(html).toContain(`<b data-t="simMensal">${v.simMensal}</b>`);
    expect(html).toContain(`href="${v.linkWhatsapp.replace(/&/g, '&amp;')}"`);
    expect(html).toContain('<span data-t="ano">');
  });

  it('cada handler e valor citado no HTML existe na lógica', () => {
    const html = readFileSync(pub('sobre/index.html'), 'utf8');
    const v = pagina().renderVals();
    const chaves = new Set<string>();
    for (const m of html.matchAll(/data-(?:if|t|html|for|on-[a-z]+)="(\w+)"/g)) chaves.add(m[1]);
    for (const m of html.matchAll(/data-(?:attr|estilo)="([^"]+)"/g)) m[1].split(',').forEach((p) => chaves.add(p.split(':')[1]));
    const faltando = [...chaves].filter((k) => !(k in v));
    expect(faltando).toEqual([]);
  });

  it('o aviso de cookies esconde a barra do celular enquanto está aberto', () => {
    const p = pagina();
    p.state.cookieBanner = true;
    expect(p.renderVals().barraTransform).toBe('translateY(110%)');
    p.state.cookieBanner = false;
    expect(p.renderVals().barraTransform).toBe('none');
  });
});
