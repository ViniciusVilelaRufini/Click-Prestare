import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Helpers locais de propósito: tsconfig.app.json compila todo src/**/*.ts que
// não é spec, e um arquivo de helper com node:fs quebraria o build do app.
function htmlDaLanding(): string {
  return readFileSync(join(process.cwd(), 'apps/portaria-web/public/sobre/index.html'), 'utf8');
}

function carregarRastreadorDaLanding(): void {
  const script = Array.from(htmlDaLanding().matchAll(/<script>([\s\S]*?)<\/script>/g))
    .map((m) => m[1])
    .find((conteudo) => conteudo.includes('window.psRegistrarLead'));
  if (!script) throw new Error('Rastreador de marketing da landing não encontrado.');
  new Function(script)();
}

function montarForm(campos: Record<string, string>): HTMLFormElement {
  document.body.innerHTML = `<form>${Object.entries(campos)
    .map(([nome, valor]) => `<input name="${nome}" value="${valor}" />`)
    .join('')}</form>`;
  return document.querySelector('form')!;
}

function prepararJanela() {
  const gtag = jest.fn();
  const oaiq = jest.fn();
  const fetch = jest.fn(() => Promise.resolve(new Response()));
  const open = jest.fn();
  Object.assign(window, { gtag, oaiq, fetch, open });
  return { gtag, oaiq, fetch, open };
}

function corpoEnviado(fetch: jest.Mock): Record<string, string> {
  return JSON.parse((fetch.mock.calls[0] as any[])[1].body);
}

describe('psRegistrarLead', () => {
  beforeEach(() => sessionStorage.clear());

  it('respeita a página informada pelo formulário', () => {
    const { fetch } = prepararJanela();
    carregarRastreadorDaLanding();
    (window as any).psRegistrarLead({ nome: 'Ana', pagina: '/sobre/#simulador' });
    expect(corpoEnviado(fetch).pagina).toBe('/sobre/#simulador');
  });

  it('usa o caminho da página quando o formulário não informa', () => {
    const { fetch } = prepararJanela();
    carregarRastreadorDaLanding();
    (window as any).psRegistrarLead({ nome: 'Ana' });
    expect(corpoEnviado(fetch).pagina).toBe(location.pathname);
  });
});

describe('psEnviarPedido', () => {
  beforeEach(() => sessionStorage.clear());

  const pedido = (form: HTMLFormElement) => ({
    form,
    obrigatorios: ['nome', 'condominio', 'contato'],
    lead: { nome: 'Ana', condominio: 'Azul', whatsapp: '(17) 99660-8148', unidades: '80 unidades', pagina: '/sobre/#simulador' },
    mensagem: 'Olá!',
    numero: '5517996608148',
  });

  it('grava o lead e abre o WhatsApp quando tudo é válido', () => {
    const { fetch, open, gtag, oaiq } = prepararJanela();
    carregarRastreadorDaLanding();
    const form = montarForm({ nome: 'Ana', condominio: 'Azul', contato: '(17) 99660-8148' });

    const ok = (window as any).psEnviarPedido(pedido(form));

    expect(ok).toBe(true);
    expect(corpoEnviado(fetch)).toMatchObject({ nome: 'Ana', whatsapp: '(17) 99660-8148', pagina: '/sobre/#simulador' });
    expect(open).toHaveBeenCalledWith('https://wa.me/5517996608148?text=Ol%C3%A1!', '_blank', 'noopener');
    expect(gtag).not.toHaveBeenCalledWith('event', 'conversion', expect.anything());
    expect(oaiq).not.toHaveBeenCalledWith('measure', 'lead_created', expect.anything());
  });

  it('não grava nem abre nada com campo obrigatório vazio', () => {
    const { fetch, open } = prepararJanela();
    carregarRastreadorDaLanding();
    const form = montarForm({ nome: 'Ana', condominio: '', contato: '(17) 99660-8148' });

    const ok = (window as any).psEnviarPedido(pedido(form));

    expect(ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect((form.elements.namedItem('condominio') as HTMLInputElement).validationMessage).toBe('Preencha este campo.');
  });

  it('recusa WhatsApp com menos de 10 dígitos', () => {
    const { fetch, open } = prepararJanela();
    carregarRastreadorDaLanding();
    const form = montarForm({ nome: 'Ana', condominio: 'Azul', contato: '99660-8148' });

    const ok = (window as any).psEnviarPedido(pedido(form));

    expect(ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect((form.elements.namedItem('contato') as HTMLInputElement).validationMessage).toBe('Informe o WhatsApp com DDD.');
  });
});

describe('psMensagemSimulador', () => {
  it('leva os dados, a simulação e a condição de lançamento', () => {
    prepararJanela();
    carregarRastreadorDaLanding();
    const msg: string = (window as any).psMensagemSimulador({
      nome: 'Ana Souza', condominio: 'Residencial Azul', whatsapp: '(17) 99660-8148', resumo: '80 unidades · Plus · R$ 773,00/mês',
    });
    expect(msg).toContain('*Nome:* Ana Souza');
    expect(msg).toContain('*Condomínio:* Residencial Azul');
    expect(msg).toContain('*WhatsApp:* (17) 99660-8148');
    expect(msg).toContain('*Simulação:* 80 unidades · Plus · R$ 773,00/mês');
    expect(msg).toContain('implantação grátis (10 primeiros condomínios)');
  });
});
