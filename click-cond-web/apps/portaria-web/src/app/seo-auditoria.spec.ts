import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const pub = (p: string) => join(process.cwd(), 'apps/portaria-web/public', p);
const sobre = () => readFileSync(pub('sobre/index.html'), 'utf8');
const sindico = () => readFileSync(pub('sindico/index.html'), 'utf8');
const texto = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const jsonLd = () => JSON.parse(sobre().match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
const NOVAS = ['/quem-somos/', '/precos/', '/controle-de-visitantes-condominio/', '/livro-de-portaria-digital/', '/reconhecimento-facial-condominio/', '/aplicativo-para-condominio/'];
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

describe('grafo da entidade igual em todas as páginas', () => {
  const B = 'https://www.prestarecondominios.com.br';
  const TODAS = ['/sobre/', '/sindico/', ...NOVAS];
  const grafo = (rota: string) => JSON.parse(pagina(rota).match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1])['@graph'] as Record<string, any>[];
  const no = (rota: string, id: string) => grafo(rota).find((n) => n['@id'] === id);
  it.each(TODAS)('%s repete a mesma Organization, com contactPoint', (rota) => {
    expect(no(rota, B + '/#org')).toEqual(no('/sobre/', B + '/#org'));
    expect(no(rota, B + '/#org').contactPoint.telephone).toBe('+55-17-99660-8148');
  });
  it.each(TODAS)('%s não redefine o #app com outra descrição', (rota) => {
    const app = no(rota, B + '/#app');
    if (app) expect(app).toEqual(no('/sobre/', B + '/#app'));
  });
  it.each(TODAS)('%s tem WebPage com about e dateModified', (rota) => {
    const pg = no(rota, `${B}${rota}#pagina`);
    expect(pg.about['@id']).toBe(rota === '/quem-somos/' ? B + '/#org' : B + '/#app');
    expect(pg.dateModified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('higiene do HTML publicado', () => {
  it.each(['/sobre/', '/sindico/', ...NOVAS])('%s não publica comentários internos', (rota) => {
    const semScripts = pagina(rota).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '');
    expect(semScripts).not.toContain('<!--');
  });
  it('não há classe que esconda conteúdo reservado', () => {
    expect(readFileSync(pub('paginas.css'), 'utf8')).not.toContain('.prova');
  });
  it.each(['/controle-de-visitantes-condominio/', '/livro-de-portaria-digital/', '/reconhecimento-facial-condominio/', '/precos/', '/aplicativo-para-condominio/'])('%s mostra a data de atualização', (rota) => {
    expect(pagina(rota)).toMatch(/<p class="pg-data">[^<]*<time datetime="\d{4}-\d{2}-\d{2}">/);
  });
});

describe('profundidade das páginas temáticas', () => {
  it('visitantes traz exemplo de relatório com as colunas reais e a comparação com caderno e planilha', () => {
    const t = texto(pagina('/controle-de-visitantes-condominio/'));
    ['Nome', 'Documento', 'Apto', 'Entrada', 'Saída', 'Autorizado por', 'No local', 'dados fictícios'].forEach((c) => expect(t).toContain(c));
    expect(t).toContain('Caderno, planilha ou sistema de controle de visitantes');
    const api = readFileSync(join(process.cwd(), 'apps/api/src/app/relatorios/relatorios.service.ts'), 'utf8');
    expect(api).toContain("['Nome', 'Documento', 'Apto', 'Entrada', 'Saída', 'Autorizado Por']");
  });
  it('livro traz exemplo da auditoria com as colunas do CSV e a comparação com o papel', () => {
    const t = texto(pagina('/livro-de-portaria-digital/'));
    ['Data', 'Usuário', 'Ação', 'Módulo', 'Descrição', 'IP'].forEach((c) => expect(t).toContain(c));
    expect(t).toContain('Livro de papel ou livro de portaria digital');
    const api = readFileSync(join(process.cwd(), 'apps/api/src/app/relatorios/relatorios.service.ts'), 'utf8');
    expect(api).toContain("['Data', 'Usuário', 'E-mail', 'Ação', 'Módulo', 'Entidade', 'Descrição', 'IP', 'Detalhes']");
  });
  it('facial cita o texto oficial da LGPD', () => {
    expect(pagina('/reconhecimento-facial-condominio/')).toContain('href="https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm"');
  });
  it('/precos/ não repete a pergunta dentro da resposta', () => {
    expect(texto(pagina('/precos/'))).not.toContain('Não. A Prestare é portaria remota?');
  });
});

describe('sitemap e llms.txt', () => {
  const sm = () => readFileSync(pub('sitemap.xml'), 'utf8');
  it('sem priority e com lastmod em toda URL', () => {
    expect(sm()).not.toContain('<priority>');
    const urls = sm().match(/<url>[\s\S]*?<\/url>/g)!;
    urls.forEach((u) => expect(u).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/));
  });
  it('inclui a página de exclusão de conta', () => expect(sm()).toContain('/exclusao-de-conta.html</loc>'));
  it('llms.txt lista as páginas do sitemap e diz que não é portaria remota', () => {
    const l = readFileSync(pub('llms.txt'), 'utf8');
    [...sm().matchAll(/<loc>([^<]+)<\/loc>/g)].forEach((m) => expect(l).toContain(`(${m[1]})`));
    expect(l).toContain('Não é central de portaria remota');
    expect(l).toContain('R$ 298');
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
  // Formato documentado do Amplify, sem <*>: o host com <*> não casava. Testado
  // em produção: mantém caminho e query (gclid) no redirecionamento.
  it('a primeira regra leva o domínio sem www para o www', () => {
    expect(regras()[0]).toEqual({ source: 'https://prestarecondominios.com.br', target: 'https://www.prestarecondominios.com.br', status: '301' });
    expect(regras().filter((r) => r.source.startsWith('https://prestarecondominios.com.br'))).toHaveLength(1);
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

describe('desempenho das páginas estáticas', () => {
  const COM_BIGWORD = ['sobre/index.html', 'sindico/index.html', '404.html', ...NOVAS.map((r) => r.slice(1) + 'index.html')];
  it.each(COM_BIGWORD)('%s: palavra decorativa do rodapé vem do CSS (sem texto de baixo contraste no DOM)', (p) => {
    const html = readFileSync(pub(p), 'utf8');
    expect(html).toContain('<div class="bigword" aria-hidden="true" data-palavra="Prestare"></div>');
    expect(html + readFileSync(pub('paginas.css'), 'utf8')).toContain('.bigword::before{content:attr(data-palavra)}');
  });
  it.each(['sindico/index.html', 'politica-de-privacidade.html', 'termos-de-uso.html', 'exclusao-de-conta.html', '404.html', ...NOVAS.map((r) => r.slice(1) + 'index.html')])(
    '%s: @font-face embutido, sem folha de fontes bloqueando a renderização',
    (p) => {
      const html = readFileSync(pub(p), 'utf8');
      expect(html).not.toContain('href="/fontes/barlow.css"');
      expect(html).toContain('src:url(/fontes/barlow-400.woff2)');
    },
  );
  it('consentimento carrega com defer (só é chamado por clique) e o build minifica os scripts da landing', () => {
    expect(sobre()).toContain('<script src="/consentimento-anuncios.js" defer></script>');
    expect(sobre()).not.toMatch(/unpkg\.com|babel|\{\{/i);
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
    expect(pkg.scripts.build).toContain('node scripts/minificar-landing.mjs');
    const script = readFileSync(join(process.cwd(), 'scripts/minificar-landing.mjs'), 'utf8');
    expect(script).toContain("'sobre/pagina.js'");
  });
});

describe('rodada 3: imagens, descrições e CSS das páginas de conteúdo', () => {
  it.each(['/precos/', '/reconhecimento-facial-condominio/'])('%s tem imagem real com alt, dimensões e legenda de dados fictícios', (rota) => {
    const html = pagina(rota);
    const img = html.match(/<figure class="pg-fig[^"]*"><img [^>]+>/)![0];
    expect(img).toMatch(/ src="\/sobre\/assets\/[^"]+\.webp"/);
    expect(img).toMatch(/ alt="[^"]{20,}"/);
    expect(img).toMatch(/ width="\d+" height="\d+"/);
    expect(html).toContain('Dados fictícios.');
    const src = img.match(/ src="([^"]+)"/)![1];
    expect(statSync(pub(src.slice(1))).size).toBeGreaterThan(1000);
  });
  it('imagens do facial existem nas duas larguras do srcset', () => {
    ['sobre/assets/app-eventos.webp', 'sobre/assets/app-eventos-360.webp'].forEach((p) => expect(statSync(pub(p)).size).toBeGreaterThan(1000));
  });
  it('preço fica no fecho da description só na /sobre, na /sindico e em /precos', () => {
    const desc = (html: string) => html.match(/<meta name="description" content="([^"]+)"/)![1];
    ['/controle-de-visitantes-condominio/', '/livro-de-portaria-digital/', '/reconhecimento-facial-condominio/', '/quem-somos/', '/aplicativo-para-condominio/'].forEach((r) => {
      expect(desc(pagina(r))).not.toContain('R$ 298');
    });
  });
  it('banner de cookies descreve Analíticos como a Política (nenhuma ferramenta carregada)', () => {
    expect(sobre()).not.toContain('Medição anônima de navegação');
    expect(sobre()).toContain('Hoje nenhuma ferramenta de análise é carregada por ela.');
    expect(readFileSync(pub('politica-de-privacidade.html'), 'utf8')).toContain('Hoje nenhuma ferramenta de análise é carregada por ela');
  });
  it('o build embute o paginas.css nas páginas de conteúdo, que o referenciam pelo mesmo link', () => {
    const script = readFileSync(join(process.cwd(), 'scripts/minificar-landing.mjs'), 'utf8');
    const link = '<link rel="stylesheet" href="/paginas.css">';
    expect(script).toContain(`const LINK_CSS = '${link}'`);
    ['404.html', ...NOVAS.map((r) => r.slice(1) + 'index.html')].forEach((p) => {
      expect(script).toContain(`'${p}'`);
      expect(readFileSync(pub(p), 'utf8')).toContain(link);
    });
    expect(readFileSync(pub('paginas.css'), 'utf8')).not.toMatch(/url\((?!\/|data:)/);
  });
});

describe('rodada 5: imagem de compartilhamento, foto do escritório e perguntas próprias de cada tema', () => {
  const OG: [string, string][] = [
    ['/sobre/', 'og-controle-de-acesso.jpg'],
    ['/quem-somos/', 'og-controle-de-acesso.jpg'],
    ['/precos/', 'og-precos.jpg'],
    ['/sindico/', 'og-sindico.jpg'],
    ['/controle-de-visitantes-condominio/', 'og-controle-de-visitantes.jpg'],
    ['/livro-de-portaria-digital/', 'og-livro-de-portaria.jpg'],
    ['/reconhecimento-facial-condominio/', 'og-reconhecimento-facial.jpg'],
    ['/aplicativo-para-condominio/', 'og-institucional.jpg'],
  ];
  it.each(OG)('%s usa a própria OG de 1200x630', (rota, arq) => {
    const html = pagina(rota);
    const url = `https://www.prestarecondominios.com.br/sobre/assets/${arq}`;
    expect(html).toMatch(new RegExp(`<meta property="og:image" content="${url}">`));
    expect(html).toContain(`<meta name="twitter:image" content="${url}">`);
    expect(html).toContain('<meta property="og:image:width" content="1200">');
    expect(html).toContain('<meta property="og:image:height" content="630">');
    expect(html).not.toContain('og-prestare-gestao');
    expect(statSync(pub('sobre/assets/' + arq)).size).toBeGreaterThan(10000);
  });
  it('foto do escritório usa o recorte sem painéis de outras marcas', () => {
    [sobre(), pagina('/quem-somos/')].forEach((html) => {
      expect(html).not.toContain('instagram-prestare-office');
      expect(html).toContain('src="/sobre/assets/escritorio-prestare-sala.webp"');
    });
  });
  it('quem-somos explica os endereços com "clickprestare"', () => {
    const t = texto(pagina('/quem-somos/'));
    expect(t).toContain('Outros nomes que você pode encontrar');
    expect(t).toContain('br.com.clickprestare.app');
  });
  it('visitantes troca as perguntas repetidas por perguntas do tema, conferidas no código', () => {
    const t = texto(pagina('/controle-de-visitantes-condominio/'));
    expect(t).not.toContain('É portaria remota?');
    expect(t).toContain('Como funciona o convite por link?');
    const api = readFileSync(join(process.cwd(), 'apps/api/src/app/convites/convites.service.ts'), 'utf8');
    expect(api).toContain('HORAS_DE_VALIDADE = 24;');
    expect(api).toContain('MAX_CONVITES_ATIVOS = 5;');
    expect(t).toContain('O link vale por 24 horas');
    expect(t).toContain('até 5 convites em aberto');
  });
  it('livro responde sobre o valor do registro sem prometer validade jurídica', () => {
    const t = texto(pagina('/livro-de-portaria-digital/'));
    expect(t).toContain('a Prestare não dá parecer jurídico');
    expect(t.toLowerCase()).not.toContain('validade jurídica garantida');
  });
});

describe('rodada 4: WebSite na raiz e páginas legais sem extensão', () => {
  const ldDe = (html: string) =>
    [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const nos = (ld: any): any[] => (Array.isArray(ld) ? ld.flatMap(nos) : ld['@graph'] ? ld['@graph'] : [ld]);
  it('a raiz publica o WebSite com url na raiz do domínio', () => {
    const raiz = readFileSync(join(process.cwd(), 'apps/portaria-web/src/index.html'), 'utf8');
    const site = ldDe(raiz).flatMap(nos).find((n) => n['@type'] === 'WebSite');
    expect(site['@id']).toBe('https://www.prestarecondominios.com.br/#site');
    expect(site.url).toBe('https://www.prestarecondominios.com.br/');
  });
  it.each(['/sobre/', '/sindico/', ...NOVAS])('WebSite de %s usa a mesma url da raiz', (rota) => {
    const site = ldDe(pagina(rota)).flatMap(nos).find((n) => n['@type'] === 'WebSite');
    expect(site.url).toBe('https://www.prestarecondominios.com.br/');
  });
  it.each([
    ['/politica-de-privacidade', '/politica-de-privacidade.html'],
    ['/politica-privacidade/', '/politica-de-privacidade.html'],
    ['/exclusao-de-conta', '/exclusao-de-conta.html'],
    ['/exclusao-conta', '/exclusao-de-conta.html'],
    ['/termos-de-uso', '/termos-de-uso.html'],
  ])('%s faz 301 para %s antes do SPA', (de, para) => {
    const r = regras();
    const i = r.findIndex((x) => x.source === de);
    expect(r[i]).toEqual({ source: de, target: para, status: '301' });
    expect(i).toBeLessThan(r.findIndex((x) => x.target === '/index.html'));
    expect(i).toBeGreaterThan(0);
  });
});

describe('rodada 6: técnica das páginas estáticas', () => {
  const cab = () => readFileSync(join(process.cwd(), '../docs/operacao/amplify-cabecalhos.yml'), 'utf8');
  it.each(['politica-de-privacidade.html', 'termos-de-uso.html', 'exclusao-de-conta.html'])('%s mostra o telefone no rodapé', (p) => {
    const rodape = readFileSync(pub(p), 'utf8').match(/<footer[\s\S]*?<\/footer>/)![0];
    expect(texto(rodape)).toContain('(17) 99660-8148');
    expect(rodape).toContain('href="https://wa.me/5517996608148"');
  });
  it('CSP em Report-Only não libera eval', () => {
    const linha = cab().match(/key: Content-Security-Policy-Report-Only\s+value: "([^"]+)"/)![1];
    expect(linha).not.toContain('unsafe-eval');
    expect(linha).toContain("object-src 'none'");
  });
  it('.txt e sitemap saem com charset utf-8', () => {
    expect(cab()).toMatch(/pattern: '\*\.txt'\s+headers:\s+- key: Content-Type\s+value: text\/plain; charset=utf-8/);
    expect(cab()).toMatch(/pattern: '\/sitemap\.xml'\s+headers:\s+- key: Content-Type\s+value: application\/xml; charset=utf-8/);
  });
  it('imagens sem versão no nome não ficam imutáveis; padrões sem classe de glob', () => {
    const h = cab();
    expect(h).not.toMatch(/pattern: '[^'\n]*\[/);
    expect(h).toMatch(/pattern: '\/sobre\/assets\/\*\.jpg'\s+headers:\s+- key: Cache-Control\s+value: public, max-age=86400/);
  });
});

describe('rodada 7: referências do grafo, fontes verificáveis e app do morador', () => {
  const B = 'https://www.prestarecondominios.com.br';
  const grafo = (html: string) => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1])['@graph'] as Record<string, any>[];
  it.each(['/sobre/', '/sindico/', ...NOVAS])('%s declara no próprio grafo todo nó que referencia', (rota) => {
    const g = grafo(pagina(rota));
    const ids = new Set(g.map((n) => n['@id']));
    const refs = JSON.stringify(g).match(/\{"@id":"[^"]+"\}/g) ?? [];
    refs.map((r) => JSON.parse(r)['@id']).filter((id) => id.startsWith(B)).forEach((id) => expect([rota, id, ids.has(id)]).toEqual([rota, id, true]));
  });
  it('captura do hero da /sobre carrega cedo, sem lazy, e só no tema ativo', () => {
    const pic = sobre().match(/<picture class="ps-tema">[\s\S]*?<\/picture>/)![0];
    const img = pic.match(/<img[^>]*>/)![0];
    expect(img).toContain('TelaInicio-dark-360.webp');
    expect(img).not.toContain('loading="lazy"');
    expect(img).toContain('fetchpriority="high"');
    expect(pic).toMatch(/<source data-tema-claro media="\(prefers-color-scheme: light\)" srcset="[^"]*TelaInicio-light-360\.webp/);
    expect(sobre().match(/TelaInicio-(?:dark|light)-360\.webp/g)!.length).toBe(2);
    expect(readFileSync(pub('sobre/pagina.js'), 'utf8')).toContain('source[data-tema-claro]');
  });
  it.each(['politica-de-privacidade.html', 'termos-de-uso.html', 'exclusao-de-conta.html'])('%s usa a OG institucional atual', (p) => {
    const html = readFileSync(pub(p), 'utf8');
    expect(html).not.toContain('og-prestare-gestao');
    expect(html).toContain('content="https://www.prestarecondominios.com.br/sobre/assets/og-institucional.jpg"');
    expect(html).toContain('<meta property="og:image:height" content="630" />');
  });
  it('comparação cita páginas oficiais da uCondo, não post de blog', () => {
    const t = sobre().match(/Informações das páginas públicas de cada fornecedor[\s\S]*?<\/p>/)![0];
    expect(t).not.toContain('ucondo.com.br/blog');
    expect(t).toContain('https://www.ucondo.com.br/ia-mora');
    expect(sobre()).not.toContain('uma versão envia boletos');
  });
  it('FTR, restauração e teste de segurança vêm com o que foi feito e como conferir', () => {
    const t = texto(sobre());
    expect(t).toContain('A AWS não publica esse resultado numa página aberta');
    expect(t).toContain('ficou disponível em cerca de 16 minutos');
    expect(t).toContain('A falha de risco alto encontrada foi corrigida');
    expect(texto(pagina('/quem-somos/'))).toContain('A AWS não publica esse resultado numa página aberta');
  });
  it('app do morador: grátis, limites honestos e itens que existem no menu do app', () => {
    const t = texto(pagina('/aplicativo-para-condominio/'));
    expect(t).toContain('Aplicativo para condomínio: o app do morador');
    expect(t).toContain('O app e o console precisam de internet');
    expect(t).toContain('integração financeira da Superlógica');
    expect(t).toContain('O reconhecimento facial é opcional');
    const menu = readFileSync(join(process.cwd(), '../click-cond-app/click-cond-app/lib/pages/shared/my_condominium.dart'), 'utf8');
    ["'Minhas Encomendas'", "'Eventos de Acesso'", "'Delivery'", "getText('lb_areas_sociais')", "getText('lb_enquetes')", "getText('lb_agendar_mudanca')"].forEach((m) => expect(menu).toContain(m));
  });
  it('menu "Para o morador" das páginas de conteúdo leva à página do app', () => {
    ['/sindico/', ...NOVAS].forEach((r) => expect(pagina(r)).not.toContain('href="/sobre/#app">Para o morador'));
  });
});

describe('conversão nas páginas de destino dos anúncios', () => {
  it.each(['/sindico/', ...NOVAS])('%s guarda a origem do anúncio e registra o clique no WhatsApp', (r) => {
    const html = pagina(r);
    expect(html).toContain('<script src="/origem-lead.js"></script>');
    expect(html).toContain('<script src="/consentimento-anuncios.js"');
  });
  it('origem-lead.js guarda gclid e registra o clique só uma vez por canal', () => {
    const js = readFileSync(pub('origem-lead.js'), 'utf8');
    expect(js).toContain("'gclid'");
    expect(js).toContain("'oppref'");
    expect(js).toContain('/api/public/leads');
    expect(js).toContain("sessionStorage.getItem('psClique_' + canal)");
  });
});
