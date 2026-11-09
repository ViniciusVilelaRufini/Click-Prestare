import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const pub = (p: string) => join(process.cwd(), 'apps/portaria-web/public', p);
const sobre = () => readFileSync(pub('sobre/index.html'), 'utf8');
const sindico = () => readFileSync(pub('sindico/index.html'), 'utf8');
const texto = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const jsonLd = () => JSON.parse(sobre().match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
const regras = () => JSON.parse(readFileSync(join(process.cwd(), '../docs/operacao/amplify-regras.json'), 'utf8')) as { source: string; target: string; status: string }[];

describe('palavras dos anúncios na /sobre', () => {
  it.each(['controle de visitantes', 'livro de portaria digital', 'app para síndico'])('cita "%s" no texto', (t) => {
    expect(texto(sobre()).toLowerCase()).toContain(t);
  });
  it('H1 fala de condomínio', () => {
    expect(sobre().match(/<h1>[\s\S]*?<\/h1>/)![0].toLowerCase()).toContain('condomínio');
  });
  it('mantém o preço no topo', () => expect(sobre()).toContain('A partir de R$ 298/mês'));
});

describe('posicionamento', () => {
  it('não usa "portaria remota" nem "remota" na página e no console', () => {
    // Nomes de classe CSS (.bloco-remota) não aparecem para o visitante nem para o Google.
    expect(sobre().replace(/bloco-remota|remota-ver/g, '').toLowerCase()).not.toContain('remota');
    expect(readFileSync(join(process.cwd(), 'apps/portaria-web/src/index.html'), 'utf8').toLowerCase()).not.toContain('remota');
  });
  it('não fala em trocar a portaria nem oferece "sem porteiro" como chamada', () => {
    expect(sobre()).not.toContain('trocar a portaria');
    expect(sobre()).not.toContain('Sem porteiro?');
  });
  it('diz no topo que funciona com o porteiro', () => {
    const hero = sobre().match(/<section class="ps-hero">[\s\S]*?<\/section>/)![0];
    expect(texto(hero)).toContain('Funciona com o seu porteiro');
  });
});

describe('identificação da empresa', () => {
  it.each([['/sobre', sobre], ['/sindico', sindico]])('%s mostra razão social, CNPJ e endereço', (_n, html) => {
    const t = texto(html());
    expect(t).toContain('PRESTARE GESTAO CONDOMINIAL INTELIGENTE LTDA');
    expect(t).toContain('09.195.104/0001-73');
    expect(t).toContain('R. Maranhão, 1368, sala 30');
    expect(t).toContain('Catanduva');
  });
});

describe('promessas verdadeiras', () => {
  it('não promete registro que não se apaga', () => {
    expect(sobre()).not.toMatch(/não se apaga/i);
  });
  it('FAQ de internet não promete que a portaria continua registrando', () => {
    expect(sobre()).not.toContain('A portaria continua registrando');
    expect(sobre()).not.toContain('<strong>Sinc.</strong>');
    expect(texto(sobre())).toContain('O app e o console precisam de internet');
  });
});

describe('dados estruturados', () => {
  it('preço e área batem com a página', () => {
    const grafo = jsonLd()['@graph'];
    const org = grafo.find((n: { '@type': string }) => n['@type'] === 'Organization');
    const app = grafo.find((n: { '@type': string }) => n['@type'] === 'SoftwareApplication');
    expect(app.offers.price).toBe('298');
    expect(app.offers.priceCurrency).toBe('BRL');
    expect(org.taxID).toBe('09.195.104/0001-73');
    expect(org.legalName).toBe('PRESTARE GESTAO CONDOMINIAL INTELIGENTE LTDA');
    expect(org.address.addressLocality).toBe('Catanduva');
    expect(org.areaServed.name).toBe('São Paulo');
    expect(org.contactPoint.areaServed).not.toBe('BR');
  });
});

describe('imagem do Instagram', () => {
  it('usa arquivo leve', () => {
    const src = sobre().match(/class="insta-foto"[\s\S]*?<img src="([^"]+)"/)![1];
    expect(src).toMatch(/\.webp$/);
    expect(statSync(pub(src.replace(/^\//, ''))).size).toBeLessThan(250 * 1024);
  });
});

describe('sitemap e /sindico', () => {
  it('sitemap inclui /sindico/', () => {
    expect(readFileSync(pub('sitemap.xml'), 'utf8')).toContain('/sindico/</loc>');
  });
  it('regra reescreve /sindico para o HTML estático antes da regra de rotas', () => {
    const r = regras();
    const i = r.findIndex((x) => x.source === '/sindico/' && x.target === '/sindico/index.html' && x.status === '200');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(r.some((x) => x.source === '/sindico' && x.target === '/sindico/index.html')).toBe(true);
  });
});

describe('página inexistente', () => {
  const spa = () => regras().find((x) => x.target === '/index.html')!;
  const casa = (caminho: string) => new RegExp(spa().source.slice(2, -2)).test(caminho);

  it('toda rota do console entra na regra do SPA', () => {
    const rotas = readFileSync(join(process.cwd(), 'apps/portaria-web/src/app/app.routes.ts'), 'utf8');
    const caminhos = [...rotas.matchAll(/path: '([^']+)'/g)].map((m) => m[1].replace(/:(\w+)/, 'x'));
    expect(caminhos.length).toBeGreaterThan(20);
    caminhos.forEach((c) => expect([c, casa('/' + c)]).toEqual([c, true]));
  });
  it('caminho desconhecido não entra no SPA', () => {
    ['/pagina-que-nao-existe-xyz', '/sobre/nao-existe', '/loginx'].forEach((c) => expect([c, casa(c)]).toEqual([c, false]));
  });
  it('o resto vira 404 real, com página própria que não indexa', () => {
    const r = regras();
    expect(r[r.length - 1]).toMatchObject({ source: '/<*>', target: '/404.html', status: '404' });
    expect(existsSync(pub('404.html'))).toBe(true);
    expect(readFileSync(pub('404.html'), 'utf8')).toContain('noindex');
  });
});

describe('cabeçalhos de segurança', () => {
  it('arquivo versionado tem os cabeçalhos', () => {
    const h = readFileSync(join(process.cwd(), '../docs/operacao/amplify-cabecalhos.yml'), 'utf8');
    ['Strict-Transport-Security', 'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy', 'Content-Security-Policy-Report-Only'].forEach((n) => expect(h).toContain(n));
  });
});
