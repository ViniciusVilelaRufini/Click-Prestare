import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const pagePath = join(process.cwd(), 'apps/portaria-web/public/sindico/index.html');
const htmlDaPaginaSindico = () => readFileSync(pagePath, 'utf8');

function carregarScriptDeLeads(): void {
  const script = Array.from(htmlDaPaginaSindico().matchAll(/<script>([\s\S]*?)<\/script>/g))
    .map((match) => match[1])
    .find((conteudo) => conteudo.includes('window.psEnviarPedido'));
  if (!script) throw new Error('Script de leads da página do síndico não encontrado.');
  new Function(script)();
}

function montarForm(campos: Record<string, string>): HTMLFormElement {
  document.body.innerHTML = `<form>${Object.entries(campos)
    .map(([nome, valor]) => `<input name="${nome}" value="${valor}" />`)
    .join('')}</form>`;
  return document.querySelector('form')!;
}

it('publica a rota, mensagem central e dois CTAs de orçamento', () => {
  expect(existsSync(pagePath)).toBe(true);
  const html = htmlDaPaginaSindico();
  expect(html).toContain('<h1>Gestão do condomínio sem consumir o seu dia.</h1>');
  expect(html).toContain('Acompanhe tudo pelo app e pelo sistema web, reduza tarefas repetitivas e tome decisões com informação em tempo real.');
  expect(html.split('Pedir orçamento para meu condomínio')).toHaveLength(3);
  expect(html).toContain('id="orcamento"');
  expect(html.match(/Pedir orçamento para meu condomínio\s*<span[^>]*aria-hidden="true"[^>]*>→<\/span>/g)).toHaveLength(2);
});

it('reutiliza a navegação desktop, menu mobile e rodapé da landing', () => {
  const html = htmlDaPaginaSindico();
  expect(html).toContain('<header class="ps-site-header"');
  expect(html).toContain('<nav class="ps-nav"');
  expect(html).toContain('<nav class="ps-mobile-nav"');
  expect(html).toContain('<footer class="ps-footer"');
  expect(html).toContain('href="/sobre/#app">Para o morador</a>');
  expect(html).toContain('href="/sindico/" aria-current="page">Para o síndico</a>');
});

it('usa uma tela real do produto no hero e inicializa a medição da landing', () => {
  const html = htmlDaPaginaSindico();
  const hero = html.match(/<section class="sindico-hero-wrap"[\s\S]*?<\/section>/)?.[0] || '';
  expect(hero).toContain('/sobre/assets/web-dashboard.png');
  expect(html).toContain('googletagmanager.com/gtag/js?id=AW-18476913499');
  expect(html).toContain('oaiq("init",{pixelId:"17H2XPR4dY5HHBNUs9L5ha"})');
  expect(html).toContain("sessionStorage.setItem('psOrigem'");
});

it('repete a hierarquia visual e os componentes principais da landing sobre', () => {
  document.documentElement.innerHTML = htmlDaPaginaSindico();

  expect(document.querySelector('.ps-nav .sindico-nav-cta')).not.toBeNull();
  expect(document.querySelector('.sindico-hero .sindico-eyebrow-pill')).not.toBeNull();
  expect(document.querySelectorAll('.sindico-hero .sindico-feature-list li')).toHaveLength(4);
  expect(document.querySelectorAll('.sindico-stats article')).toHaveLength(4);
  expect(document.querySelectorAll('.sindico-gains .sindico-icon-chip')).toHaveLength(3);
  expect(document.querySelectorAll('.sindico-process-grid .sindico-icon-chip')).toHaveLength(6);
  expect(document.querySelector('.sindico-console-featured')).not.toBeNull();
});

it('mostra processos e telas reais do console', () => {
  const html = htmlDaPaginaSindico();
  ['Visitantes', 'Encomendas', 'Comunicados', 'Áreas sociais', 'Financeiro', 'Ocorrências'].forEach((t) => expect(html).toContain(t));
  ['web-dashboard.png', 'web-visitantes.png', 'web-financeiro.png', 'web-autorizacao.png'].forEach((a) => expect(html).toContain(`/sobre/assets/${a}`));
  expect(html).toContain('aspect-ratio: 16 / 10');
});

it('leva as três entradas Para o síndico para a rota dedicada', () => {
  const landing = readFileSync(join(process.cwd(), 'apps/portaria-web/public/sobre/index.html'), 'utf8');
  const links = Array.from(landing.matchAll(/<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g))
    .filter(([, , content]) => content.includes('Para o síndico'));
  expect(links).toHaveLength(3);
  expect(links.map(([, href]) => href)).toEqual(['/sindico/', '/sindico/', '/sindico/']);
});

it('abre o WhatsApp somente após registrar um lead válido', async () => {
  let resolverRegistro: (value: { ok: boolean }) => void;
  const fetch = jest.fn(() => new Promise<{ ok: boolean }>((resolve) => { resolverRegistro = resolve; }));
  const open = jest.fn();
  Object.assign(window, { fetch, open });
  carregarScriptDeLeads();

  const invalido = montarForm({ nome: '', condominio: 'Residencial Azul', contato: '(17) 99660-8148' });
  await expect((window as any).psEnviarPedido({ form: invalido, pagina: '/sindico/#orcamento' })).resolves.toBe(false);
  expect(fetch).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();

  sessionStorage.setItem('psOrigem', JSON.stringify({ utm_source: 'google', gclid: 'click-123' }));
  const valido = montarForm({ nome: 'Ana', condominio: 'Residencial Azul', contato: '(17) 99660-8148', unidades: '84' });
  const envio = (window as any).psEnviarPedido({ form: valido, pagina: '/sindico/#orcamento' });
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
    nome: 'Ana', condominio: 'Residencial Azul', whatsapp: '(17) 99660-8148', unidades: '84',
    pagina: '/sindico/#orcamento', utm_source: 'google', gclid: 'click-123',
  });
  expect(open).not.toHaveBeenCalled();
  resolverRegistro!({ ok: true });
  await expect(envio).resolves.toBe(true);
  expect(open).toHaveBeenCalledWith(expect.stringContaining('https://wa.me/5517996608148'), '_blank', 'noopener');
});

it('exibe unidades como campo obrigatório no formulário', () => {
  const html = htmlDaPaginaSindico();
  expect(html).toMatch(/<label[^>]*>\s*Quantas unidades[\s\S]*?<input[^>]*name="unidades"[^>]*required/);
});

it('informa e foca um telefone não vazio inválido', async () => {
  const fetch = jest.fn();
  Object.assign(window, { fetch, open: jest.fn() });
  carregarScriptDeLeads();
  const form = montarForm({ nome: 'Ana', condominio: 'Residencial Azul', contato: '1234', unidades: '84' });
  const contato = form.elements.namedItem('contato') as HTMLInputElement;
  const focus = jest.spyOn(contato, 'focus');
  const reportValidity = jest.spyOn(form, 'reportValidity').mockReturnValue(false);

  await expect((window as any).psEnviarPedido({ form, pagina: '/sindico/#orcamento' })).resolves.toBe(false);
  expect(contato.validationMessage).toBe('Informe o WhatsApp com DDD.');
  expect(reportValidity).toHaveBeenCalled();
  expect(focus).toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it('impede leads e abas duplicados enquanto o envio está pendente', async () => {
  let resolverRegistro: (value: { ok: boolean }) => void;
  const fetch = jest.fn(() => new Promise<{ ok: boolean }>((resolve) => { resolverRegistro = resolve; }));
  const open = jest.fn();
  Object.assign(window, { fetch, open });
  carregarScriptDeLeads();
  const form = montarForm({ nome: 'Ana', condominio: 'Residencial Azul', contato: '(17) 99660-8148', unidades: '84' });

  const primeiro = (window as any).psEnviarPedido({ form, pagina: '/sindico/#orcamento' });
  const segundo = (window as any).psEnviarPedido({ form, pagina: '/sindico/#orcamento' });
  expect(fetch).toHaveBeenCalledTimes(1);
  resolverRegistro!({ ok: true });
  await expect(Promise.all([primeiro, segundo])).resolves.toEqual([true, false]);
  expect(open).toHaveBeenCalledTimes(1);
});

it('não abre o WhatsApp quando o registro do lead falha', async () => {
  const fetch = jest.fn(() => Promise.reject(new Error('CRM indisponível')));
  const open = jest.fn();
  Object.assign(window, { fetch, open });
  carregarScriptDeLeads();
  const form = montarForm({ nome: 'Ana', condominio: 'Residencial Azul', contato: '(17) 99660-8148', unidades: '84' });

  await expect((window as any).psEnviarPedido({ form, pagina: '/sindico/#orcamento' })).resolves.toBe(false);
  expect(open).not.toHaveBeenCalled();
});
