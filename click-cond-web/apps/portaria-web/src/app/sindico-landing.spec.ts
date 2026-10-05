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
});

it('mostra processos e telas reais do console', () => {
  const html = htmlDaPaginaSindico();
  ['Visitantes', 'Encomendas', 'Comunicados', 'Áreas sociais', 'Financeiro', 'Ocorrências'].forEach((t) => expect(html).toContain(t));
  ['web-dashboard.png', 'web-visitantes.png', 'web-financeiro.png', 'web-autorizacao.png'].forEach((a) => expect(html).toContain(`/sobre/assets/${a}`));
  expect(html).toContain('aspect-ratio: 16 / 10');
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

  const valido = montarForm({ nome: 'Ana', condominio: 'Residencial Azul', contato: '(17) 99660-8148' });
  const envio = (window as any).psEnviarPedido({ form: valido, pagina: '/sindico/#orcamento' });
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
    nome: 'Ana', condominio: 'Residencial Azul', whatsapp: '(17) 99660-8148', pagina: '/sindico/#orcamento',
  });
  expect(open).not.toHaveBeenCalled();
  resolverRegistro!({ ok: true });
  await expect(envio).resolves.toBe(true);
  expect(open).toHaveBeenCalledWith(expect.stringContaining('https://wa.me/5517996608148'), '_blank', 'noopener');
});

it('não abre o WhatsApp quando o registro do lead falha', async () => {
  const fetch = jest.fn(() => Promise.reject(new Error('CRM indisponível')));
  const open = jest.fn();
  Object.assign(window, { fetch, open });
  carregarScriptDeLeads();
  const form = montarForm({ nome: 'Ana', condominio: 'Residencial Azul', contato: '(17) 99660-8148' });

  await expect((window as any).psEnviarPedido({ form, pagina: '/sindico/#orcamento' })).resolves.toBe(false);
  expect(open).not.toHaveBeenCalled();
});
