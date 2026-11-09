import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const pub = (p: string) => join(process.cwd(), 'apps/portaria-web/public', p);
const sobre = () => readFileSync(pub('sobre/index.html'), 'utf8');
const sindico = () => readFileSync(pub('sindico/index.html'), 'utf8');
const texto = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const jsonLd = () => JSON.parse(sobre().match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
const NOVAS = ['/quem-somos/', '/precos/', '/controle-de-visitantes-condominio/', '/livro-de-portaria-digital/', '/reconhecimento-facial-condominio/'];
const pagina = (rota: string) => readFileSync(pub(rota.slice(1) + 'index.html'), 'utf8');
const regras = () => JSON.parse(readFileSync(join(process.cwd(), '../docs/operacao/amplify-regras.json'), 'utf8')) as { source: string; target: string; status: string }[];

describe('palavras dos anúncios na /sobre', () => {
  it.each(['controle de visitantes', 'livro de portaria digital', 'app para síndico', 'sistema de portaria', 'aplicativo para condomínio', 'sistema para síndico', 'reconhecimento facial'])('cita "%s" no texto', (t) => {
    expect(texto(sobre()).toLowerCase()).toContain(t);
  });
  it('H1 fala de condomínio', () => {
    expect(sobre().match(/<h1>[\s\S]*?<\/h1>/)![0].toLowerCase()).toContain('condomínio');
  });
  it('mantém o preço no topo', () => expect(sobre()).toContain('A partir de R$ 298/mês'));
  it('H1 tem espaço entre as linhas (extração sem CSS)', () => {
    expect(texto(sobre().match(/<h1>[\s\S]*?<\/h1>/)![0]).trim()).toBe('Controle de Acesso para Condomínios');
  });
  it('bloco do síndico logo depois do hero', () => {
    const html = sobre();
    const fimHero = html.indexOf('</section>', html.indexOf('<section class="ps-hero">'));
    const sindicoEm = html.indexOf('<section id="sindico">');
    expect(sindicoEm).toBeGreaterThan(fimHero);
    expect(html.slice(fimHero, sindicoEm).replace(/\s|<\/div>/g, '')).toBe('</section>');
  });
  it('tem seção de reconhecimento facial com LGPD e alternativa a quem recusa', () => {
    const sec = sobre().match(/<section id="reconhecimento-facial">[\s\S]*?<\/section>/)![0];
    expect(sec).toContain('<h2');
    expect(texto(sec)).toContain('opcional');
    expect(texto(sec)).toContain('dado pessoal sensível');
    expect(texto(sec)).toContain('quem não quiser cadastrar o rosto');
    expect(sec).toContain('/politica-de-privacidade.html');
  });
  it.each(['#simulador', '#seguranca', '#portaria-app', '#contato'])('mantém a âncora dos anúncios %s', (a) => {
    expect(sobre()).toContain(`id="${a.slice(1)}"`);
  });
});

describe('posicionamento', () => {
  it('só cita "remota" para negar que seja portaria remota', () => {
    // Nomes de classe CSS (.bloco-remota) não aparecem para o visitante nem para o Google.
    // A única ocorrência permitida é a pergunta da FAQ, cuja resposta é "Não".
    const semNegacao = (html: string) => html.replace(/bloco-remota|remota-ver/g, '').replace(/A Prestare é portaria remota\?<\/h3>/g, '');
    expect(semNegacao(sobre()).toLowerCase()).not.toContain('remota');
    expect(readFileSync(join(process.cwd(), 'apps/portaria-web/src/index.html'), 'utf8').toLowerCase()).not.toContain('remota');
  });
  it('não fala em trocar a portaria nem oferece "sem porteiro" como chamada', () => {
    expect(sobre()).not.toContain('trocar a portaria');
    expect(sobre()).not.toContain('Sem porteiro?');
  });
  it('FAQ responde que não é portaria remota', () => {
    [sobre(), sindico()].forEach((html) => expect(texto(html)).toContain('A Prestare é portaria remota? Não. Não há central 24h nem operador à distância'));
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
  // A máscara é só visual e revelar o documento não gera registro; "24/7" e
  // os absolutos de segurança não têm respaldo no código.
  it.each(['com o acesso registrado', 'nem mais, nem menos', 'o sistema inteiro', 'Seguro desde o primeiro dia', 'a AWS avaliou', '24/7', 'Cada módulo é ligado por condomínio', 'Resposta na hora', 'revelado só por permissão'])('não afirma "%s"', (frase) => {
    [sobre(), sindico(), ...NOVAS.map((r) => pagina(r))].forEach((html) => expect(html.toLowerCase()).not.toContain(frase.toLowerCase()));
  });
  it('exemplo de documento é fictício e placeholder não usa nome real', () => {
    [sobre(), sindico()].forEach((html) => {
      expect(html).not.toContain('453.***');
      expect(html).not.toContain('Rufini');
    });
    expect(sobre()).toContain('123.***.***-00');
  });
  it('diz que as capturas usam dados fictícios', () => {
    [sobre(), sindico()].forEach((html) => expect(texto(html)).toContain('Telas do sistema com dados fictícios'));
  });
  it('FAQ de internet não promete que a portaria continua registrando', () => {
    expect(sobre()).not.toContain('A portaria continua registrando');
    expect(sobre()).not.toContain('<strong>Sinc.</strong>');
    expect(texto(sobre())).toContain('O app e o console precisam de internet');
  });
});

describe('marca', () => {
  it.each([['/sobre', sobre], ['/sindico', sindico]])('%s usa só "Prestare Gestão" como nome público', (_n, html) => {
    ['Prestare Portaria', 'Prestare Soluções', 'Prestare Condomínios'].forEach((n) => expect(html()).not.toContain(n));
    expect(texto(html())).toContain('Prestare Gestão: controle de acesso para condomínios');
  });
});

describe('/sindico voltada a síndico', () => {
  it('title, H1 e description falam de sistema e app para síndico', () => {
    const html = sindico();
    expect(html.match(/<title>([^<]+)<\/title>/)![1].toLowerCase()).toContain('sistema para síndico');
    expect(html.match(/<h1[^>]*>([^<]+)<\/h1>/)![1].toLowerCase()).toContain('sistema para síndico');
    expect(html.match(/<meta name="description" content="([^"]+)"/)![1]).toContain('R$ 298');
  });
  it('tem preço, FAQ e JSON-LD com a Organization', () => {
    const html = sindico();
    expect(texto(html)).toContain('R$ 490');
    expect(html).toContain('class="pg-faq"');
    const g = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1])['@graph'];
    expect(g.find((n: { '@type': string }) => n['@type'] === 'Organization').taxID).toBe('09.195.104/0001-73');
    expect(g.some((n: { '@type': string }) => n['@type'] === 'BreadcrumbList')).toBe(true);
  });
  it('sem img vazia nem heading vazio', () => {
    [sobre(), sindico()].forEach((html) => {
      expect(html).not.toMatch(/<img[^>]*src=""/);
      expect(html).not.toMatch(/<h[1-6][^>]*><\/h[1-6]>/);
    });
  });
});

describe('páginas novas', () => {
  it.each(NOVAS)('%s tem title, description, canonical, H1, JSON-LD e links internos', (rota) => {
    const html = pagina(rota);
    expect(html).toContain('<html lang="pt-BR">');
    expect(html.match(/<title>([^<]+)<\/title>/)![1]).toContain('Prestare Gestão');
    expect(html.match(/<meta name="description" content="([^"]+)"/)![1].length).toBeLessThanOrEqual(170);
    expect(html).toContain(`<link rel="canonical" href="https://www.prestarecondominios.com.br${rota}">`);
    expect(html.match(/<h1>/g)!.length).toBe(1);
    const g = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1])['@graph'];
    expect(g.some((n: { '@type': string }) => n['@type'] === 'BreadcrumbList')).toBe(true);
    expect(html).toContain('href="/sobre/#simulador"');
    expect(html).toContain('09.195.104/0001-73');
    NOVAS.filter((r) => r !== rota).forEach((r) => expect(html).toContain(`href="${r}"`));
    expect(html).not.toContain('aggregateRating');
    expect(html).not.toContain('—');
  });
  it('/precos/ bate com o calcularPlano da /sobre', () => {
    const t = texto(pagina('/precos/'));
    ['R$ 298,00', 'R$ 9,90', 'R$ 8,90', 'R$ 11,90', 'R$ 490,00', 'R$ 773,00', 'R$ 595,00', 'R$ 1.129,00', 'R$ 1.486,00'].forEach((v) => expect(t).toContain(v));
    const logica = readFileSync(pub('sobre/pagina.js'), 'utf8');
    expect(logica).toContain('298 + faixa(30, 60, 9.9) + faixa(60, 120, 8.9) + faixa(120, Infinity, 11.9)');
    expect(logica).toContain('IMPLANTACAO = 490;');
  });
  it('sitemap lista as páginas novas', () => {
    const sm = readFileSync(pub('sitemap.xml'), 'utf8');
    NOVAS.forEach((r) => expect(sm).toContain(`https://www.prestarecondominios.com.br${r}</loc>`));
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
    const src = sobre().match(/class="insta-foto"[\s\S]*?<img[^>]*\ssrc="([^"]+)"/)![1];
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
    expect(r.some((x) => x.source === '/sindico' && x.target === '/sindico/' && x.status === '301')).toBe(true);
  });
});

describe('regras do Amplify', () => {
  const ESTATICAS = ['/sobre', '/sindico', ...NOVAS.map((r) => r.slice(0, -1))];
  it('a primeira regra leva o domínio sem www para o www, com o caminho', () => {
    expect(regras()[0]).toEqual({ source: 'https://prestarecondominios.com.br/<*>', target: 'https://www.prestarecondominios.com.br/<*>', status: '301' });
  });
  it.each(ESTATICAS)('%s sem barra vai por 301 para a versão com barra, que serve o HTML estático', (rota) => {
    const r = regras();
    expect(r.some((x) => x.source === rota && x.target === rota + '/' && x.status === '301')).toBe(true);
    expect(r.some((x) => x.source === rota + '/' && x.target === rota + '/index.html' && x.status === '200')).toBe(true);
  });
  it('rotas do console não aceitam sufixo qualquer (soft-404)', () => {
    const spa = regras().find((x) => x.target === '/index.html')!;
    const re = new RegExp(spa.source.slice(2, -2));
    ['/dashboard/abc', '/login/qualquer', '/prestadores/x'].forEach((c) => expect([c, re.test(c)]).toEqual([c, false]));
    ['/convite/abc_DEF-123', '/prestadores/cadastro', '/login/'].forEach((c) => expect([c, re.test(c)]).toEqual([c, true]));
  });
});

describe('raiz do console (src/index.html)', () => {
  const raiz = () => readFileSync(join(process.cwd(), 'apps/portaria-web/src/index.html'), 'utf8');
  it('está em português, com H1 e link para /sobre/ no conteúdo inicial', () => {
    const html = raiz();
    expect(html).toContain('<html lang="pt-BR">');
    expect(html).toMatch(/<app-root>[\s\S]*<h1>[\s\S]*href="\/sobre\/"[\s\S]*<\/app-root>/);
  });
  it('não aponta canônica cruzada e fica fora da busca', () => {
    const html = raiz();
    expect(html).not.toContain('rel="canonical"');
    expect(html).toContain('<meta name="robots" content="noindex, follow" />');
  });
});

describe('fontes e aviso de cookies', () => {
  const PAGINAS = ['sobre/index.html', 'sindico/index.html', ...NOVAS.map((r) => r.slice(1) + 'index.html'), 'politica-de-privacidade.html', 'termos-de-uso.html', 'exclusao-de-conta.html', '404.html'];
  it.each(PAGINAS)('%s usa as fontes do próprio site', (p) => {
    const html = readFileSync(pub(p), 'utf8');
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).not.toContain('fonts.gstatic.com');
    expect(html).toMatch(/\/fontes\/barlow/);
  });
  it('os arquivos de fonte existem', () => {
    ['barlow-400', 'barlow-500', 'barlow-600', 'barlow-condensed-300', 'barlow-condensed-400', 'barlow-condensed-500', 'barlow-condensed-600'].forEach((f) =>
      expect(statSync(pub(`fontes/${f}.woff2`)).size).toBeGreaterThan(10000));
  });
  it('Rejeitar tem o mesmo peso visual de Aceitar', () => {
    const s = sobre();
    expect(s).toContain('<button type="button" class="btn sm" data-on-click="rejeitarCookies">Rejeitar</button>');
    expect(s).toContain('<button type="button" class="btn sm" data-on-click="aceitarCookies">Aceitar</button>');
    const d = sindico();
    expect(d).toContain('<button type="button" class="btn" id="sindicoCookieRejeitar">Rejeitar</button>');
    expect(d).toContain('<button type="button" class="btn" id="sindicoCookieAceitar">Aceitar</button>');
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
  it('a raiz continua indo para o console', () => expect(casa('/')).toBe(true));
  it('caminho desconhecido não entra no SPA', () => {
    ['/pagina-que-nao-existe-xyz', '/sobre/nao-existe', '/loginx'].forEach((c) => expect([c, casa(c)]).toEqual([c, false]));
  });
  it('sem regra pegando todo o resto: o Amplify responde 404 real (vazio) ao que nao existe', () => {
    const r = regras();
    expect(r.some((x) => x.source === '/<*>')).toBe(false);
    expect(r[r.length - 1].target).toBe('/index.html');
  });
});

describe('cabeçalhos de segurança', () => {
  it('arquivo versionado tem os cabeçalhos', () => {
    const h = readFileSync(join(process.cwd(), '../docs/operacao/amplify-cabecalhos.yml'), 'utf8');
    ['Strict-Transport-Security', 'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy', 'Content-Security-Policy-Report-Only'].forEach((n) => expect(h).toContain(n));
  });
  it('HSTS com subdomínios, noindex no console e cache imutável nos arquivos com hash', () => {
    const h = readFileSync(join(process.cwd(), '../docs/operacao/amplify-cabecalhos.yml'), 'utf8');
    expect(h).toContain('max-age=63072000; includeSubDomains');
    ["'/'", "'/login'", "'/dashboard'", "'/convite/*'"].forEach((p) => expect(h).toContain(`pattern: ${p}`));
    expect(h).toMatch(/pattern: '\/chunk-\*\.js'\s+headers:\s+- key: Cache-Control\s+value: public, max-age=31536000, immutable/);
  });
});
