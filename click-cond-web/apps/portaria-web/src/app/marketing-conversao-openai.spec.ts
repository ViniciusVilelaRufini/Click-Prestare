import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function carregarRastreadorDaLanding(): void {
  const html = readFileSync(join(process.cwd(), 'apps/portaria-web/public/sobre/index.html'), 'utf8');
  const script = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g))
    .map((match) => match[1])
    .find((content) => content.includes('window.psRegistrarLead'));

  if (!script) throw new Error('Rastreador de marketing da landing não encontrado.');
  new Function(script)();
}

function carregarEnvioDoFormulario(): (this: any, event: SubmitEvent) => void {
  const html = readFileSync(join(process.cwd(), 'apps/portaria-web/public/sobre/index.html'), 'utf8');
  const inicio = html.indexOf('  enviar = (e) => {');
  const fim = html.lastIndexOf('\n  };', html.indexOf('  renderVals()', inicio));
  if (inicio < 0 || fim < 0) throw new Error('Handler de envio da landing nÃ£o encontrado.');
  const corpo = html.slice(inicio, fim + 5).replace('enviar = (e) =>', 'return function enviar(e)');
  return new Function(corpo)();
}

describe('conversão da OpenAI na landing', () => {
  it('não registra lead_created quando o visitante apenas clica no WhatsApp', () => {
    document.body.innerHTML = '<a id="whatsapp" href="https://wa.me/5517996608148">Falar no WhatsApp</a>';
    sessionStorage.clear();
    const gtag = jest.fn();
    const oaiq = jest.fn();
    const fetch = jest.fn(() => Promise.resolve(new Response()));
    Object.assign(window, { gtag, oaiq, fetch });

    carregarRastreadorDaLanding();
    document.querySelector<HTMLAnchorElement>('#whatsapp')!.click();

    expect(gtag).not.toHaveBeenCalled();
    expect(oaiq).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/public/leads'),
      expect.objectContaining({ body: expect.stringContaining('"clique":"whatsapp"') }),
    );
  });

  it('does not call paid conversions when a valid form is submitted', () => {
    document.body.innerHTML = `
      <form>
        <input name="nome" value="Ana" />
        <input name="contato" value="(17) 99660-8148" />
        <input name="condominio" value="CondomÃ­nio Azul" />
        <input name="unidades" value="24" />
        <input name="site" value="https://azul.example" />
      </form>`;
    const gtag = jest.fn();
    const oaiq = jest.fn();
    const fetch = jest.fn(() => Promise.resolve(new Response()));
    const open = jest.fn();
    Object.assign(window, { gtag, oaiq, fetch, open });

    carregarRastreadorDaLanding();
    const enviar = carregarEnvioDoFormulario();
    const form = document.querySelector('form')!;
    enviar.call({
      _enviando: false,
      state: { enviado: false },
      props: { whatsapp: '5517996608148' },
      tituloCaso: (v: string) => v,
      formatarTelefone: (v: string) => v,
      setState: jest.fn(),
    }, { preventDefault: jest.fn(), target: form } as unknown as SubmitEvent);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/public/leads'),
      expect.objectContaining({ body: expect.stringContaining('"whatsapp":"(17) 99660-8148"') }),
    );
    expect(open).toHaveBeenCalledWith(expect.stringContaining('https://wa.me/5517996608148?text='), '_blank', 'noopener');
    expect(oaiq).not.toHaveBeenCalledWith('measure', 'lead_created', expect.anything());
    expect(gtag).not.toHaveBeenCalledWith('event', 'conversion', expect.anything());
  });
});
