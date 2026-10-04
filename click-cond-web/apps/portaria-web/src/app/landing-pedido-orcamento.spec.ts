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

/** Extrai `  nome = (e) => { ... };` da classe do componente como função comum. */
function carregarHandler(nome: string): (this: any, event: any) => void {
  const html = htmlDaLanding();
  const inicio = html.indexOf(`  ${nome} = (e) => {`);
  const fim = html.indexOf('\n  };', inicio);
  if (inicio < 0 || fim < 0) throw new Error(`Handler ${nome} da landing não encontrado.`);
  const corpo = html.slice(inicio, fim + 5).replace(`${nome} = (e) =>`, `return function ${nome}(e)`);
  return new Function(corpo)();
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

describe('formulário #contato', () => {
  beforeEach(() => sessionStorage.clear());

  const contexto = () => ({
    _enviando: false,
    state: { enviado: false },
    props: { whatsapp: '5517996608148' },
    tituloCaso: (v: string) => v,
    formatarTelefone: (v: string) => v,
    setState: jest.fn(),
  });

  it('grava o lead marcado como #contato e abre o WhatsApp', () => {
    const { fetch, open } = prepararJanela();
    carregarRastreadorDaLanding();
    const form = montarForm({ nome: 'Ana', contato: '(17) 99660-8148', condominio: 'Azul', unidades: '24', site: '' });
    const ctx = contexto();

    carregarHandler('enviar').call(ctx, { preventDefault: jest.fn(), target: form });

    expect(corpoEnviado(fetch)).toMatchObject({ nome: 'Ana', unidades: '24', pagina: '/sobre/#contato' });
    expect(open).toHaveBeenCalledWith(expect.stringContaining('https://wa.me/5517996608148?text='), '_blank', 'noopener');
    expect(ctx.setState).toHaveBeenCalledWith({ enviado: true });
  });

  it('não envia com WhatsApp curto', () => {
    const { fetch, open } = prepararJanela();
    carregarRastreadorDaLanding();
    const form = montarForm({ nome: 'Ana', contato: '9966', condominio: 'Azul', unidades: '24', site: '' });
    const ctx = contexto();

    carregarHandler('enviar').call(ctx, { preventDefault: jest.fn(), target: form });

    expect(fetch).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(ctx.setState).not.toHaveBeenCalled();
  });
});

describe('formulário do simulador', () => {
  beforeEach(() => sessionStorage.clear());

  const contexto = () => ({
    _enviandoSim: false,
    state: { simEnviado: false, simUnidades: 80 },
    props: { whatsapp: '5517996608148' },
    tituloCaso: (v: string) => v,
    formatarTelefone: (v: string) => v,
    calcularPlano: () => ({ plano: 'Plus', incluso: '', mensal: 773 }),
    brl: (v: number) => 'R$ ' + v.toFixed(2).replace('.', ','),
    setState: jest.fn(),
  });

  it('grava o lead com a simulação e marca a origem #simulador', () => {
    const { fetch, open } = prepararJanela();
    carregarRastreadorDaLanding();
    const form = montarForm({ nome: 'Ana', condominio: 'Azul', contato: '(17) 99660-8148', site: '' });
    const ctx = contexto();

    carregarHandler('enviarSimulador').call(ctx, { preventDefault: jest.fn(), target: form });

    expect(corpoEnviado(fetch)).toMatchObject({
      nome: 'Ana',
      condominio: 'Azul',
      whatsapp: '(17) 99660-8148',
      unidades: '80 unidades · Plus · R$ 773,00/mês',
      pagina: '/sobre/#simulador',
    });
    const url = decodeURIComponent((open.mock.calls[0] as any[])[0]);
    expect(url).toContain('*Simulação:* 80 unidades · Plus · R$ 773,00/mês');
    expect(url).toContain('implantação grátis');
    expect(ctx.setState).toHaveBeenCalledWith({ simEnviado: true });
  });

  it('não envia sem o nome do condomínio', () => {
    const { fetch, open } = prepararJanela();
    carregarRastreadorDaLanding();
    const form = montarForm({ nome: 'Ana', condominio: '', contato: '(17) 99660-8148', site: '' });
    const ctx = contexto();

    carregarHandler('enviarSimulador').call(ctx, { preventDefault: jest.fn(), target: form });

    expect(fetch).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(ctx.setState).not.toHaveBeenCalled();
  });

  it('não envia duas vezes', () => {
    const { fetch } = prepararJanela();
    carregarRastreadorDaLanding();
    const form = montarForm({ nome: 'Ana', condominio: 'Azul', contato: '(17) 99660-8148', site: '' });
    const ctx = { ...contexto(), state: { simEnviado: true, simUnidades: 80 } };

    carregarHandler('enviarSimulador').call(ctx, { preventDefault: jest.fn(), target: form });

    expect(fetch).not.toHaveBeenCalled();
  });

  it('o card do simulador tem o formulário, o selo e o atalho do WhatsApp', () => {
    const html = htmlDaLanding();
    const inicio = html.indexOf('<section id="simulador"');
    const card = html.slice(inicio, html.indexOf('</section>', inicio));
    expect(card).toContain('onSubmit="{{ enviarSimulador }}"');
    expect(card).toContain('Receber minha proposta');
    expect(card).toContain('implantação grátis para os 10 primeiros condomínios');
    expect(card).toContain('Prefere falar direto? Abrir o WhatsApp');
    expect(card).toContain('Sem compromisso');
    expect(card).toContain('Proposta com o valor exato do seu condomínio');
    expect(card).toContain('Seus dados sob a LGPD, sem spam');
  });
});

describe('caminho até o preço', () => {
  const trecho = (html: string, inicioMarca: string, fimMarca: string) => {
    const inicio = html.indexOf(inicioMarca);
    return html.slice(inicio, html.indexOf(fimMarca, inicio));
  };

  it('o botão principal do topo leva ao simulador, não ao WhatsApp', () => {
    const hero = trecho(htmlDaLanding(), '<section class="ps-hero"', '</section>');
    expect(hero).not.toContain('linkWhatsapp');
    expect(hero).toContain('href="#simulador"');
    expect(hero).toContain('Ver o preço para o meu condomínio');
    expect(hero).toContain('A partir de R$ 298/mês');
  });

  it('o simulador explica o produto para quem chega do anúncio', () => {
    const sim = trecho(htmlDaLanding(), '<section id="simulador"', '</section>');
    expect(sim).toContain('Controle de acesso com reconhecimento facial');
  });

  it('a barra do celular leva ao simulador', () => {
    const barra = trecho(htmlDaLanding(), '<div class="ps-barra"', '</div>');
    expect(barra).toContain('href="#simulador"');
    expect(barra).toContain('Ver meu preço');
    expect(barra).toContain('{{ barraTransform }}');
  });
});

describe('textos de resposta e oferta', () => {
  it('não promete mais resposta em 1 dia útil', () => {
    const html = htmlDaLanding();
    expect(html).not.toContain('Resposta em até 1 dia útil');
    expect(html.split('Resposta na hora pelo WhatsApp').length - 1).toBe(2);
    expect(html).toContain('Atendimento humano em horário comercial');
  });

  it('o contato e o FAQ explicam a condição de lançamento', () => {
    const html = htmlDaLanding();
    expect(html).toContain('Condição de lançamento: implantação grátis para os 10 primeiros condomínios.');
    expect(html).toContain('Como funciona a implantação grátis?');
  });

  it('não usa promessas que a Prestare não oferece', () => {
    const html = htmlDaLanding().toLowerCase();
    expect(html).not.toContain('sem fidelidade');
    expect(html).not.toContain('período de teste');
  });
});

describe('correções finais da revisão', () => {
  function simLink(unidades: string): string {
    const html = htmlDaLanding();
    const inicio = html.indexOf('  simVals(num) {');
    const fim = html.indexOf('\n  }\n', inicio);
    if (inicio < 0 || fim < 0) throw new Error('simVals da landing não encontrado.');
    const corpo = html.slice(inicio, fim + 4).replace('simVals(num) {', 'return function simVals(num) {');
    const simVals = new Function(corpo)();
    const contexto = {
      state: { simUnidades: unidades, simEnviado: false },
      calcularPlano: () => ({ plano: 'Plus', incluso: '', mensal: 773 }),
      brl: (v: number) => 'R$ ' + v.toFixed(2).replace('.', ','),
      IMPLANTACAO: 490,
      PLANOS: [],
    };
    return decodeURIComponent(simVals.call(contexto, '5517996608148').simLink);
  }

  it('o link direto do simulador não cita R$ 490 e fala da condição de lançamento', () => {
    const texto = simLink('80');
    expect(texto).toContain('R$ 773,00/mês, implantação grátis na condição de lançamento');
    expect(texto).not.toContain('R$ 490');
    expect(texto).not.toContain('implantação de');
  });

  it('o link direto sem valor mantém a mensagem genérica', () => {
    expect(simLink('')).toContain('Quero um orçamento do Prestare Gestão');
  });

  const invalidar = () => {
    prepararJanela();
    carregarRastreadorDaLanding();
    const form = montarForm({ nome: 'Ana', condominio: '', contato: '(17) 99660-8148' });
    (window as any).psEnviarPedido({
      form,
      obrigatorios: ['nome', 'condominio', 'contato'],
      lead: { nome: 'Ana', condominio: '', whatsapp: '', unidades: '', pagina: '/' },
      mensagem: 'Olá!',
      numero: '5517996608148',
    });
    const campo = form.elements.namedItem('condominio') as HTMLInputElement;
    expect(campo.validationMessage).toBe('Preencha este campo.');
    return campo;
  };

  it('libera o campo inválido quando só o evento change dispara (autofill)', () => {
    const campo = invalidar();
    campo.dispatchEvent(new Event('change'));
    expect(campo.validationMessage).toBe('');
  });

  it('libera o campo inválido no evento input', () => {
    const campo = invalidar();
    campo.dispatchEvent(new Event('input'));
    expect(campo.validationMessage).toBe('');
  });
});
