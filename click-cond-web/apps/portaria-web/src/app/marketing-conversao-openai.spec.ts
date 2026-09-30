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
    document.body.innerHTML = '';
    const gtag = jest.fn();
    const oaiq = jest.fn();
    Object.assign(window, { gtag, oaiq, fetch: jest.fn(() => Promise.resolve(new Response())) });

    carregarRastreadorDaLanding();

    (window as any).psRegistrarLead({ nome: 'Ana', whatsapp: '5517996608148' });

    expect(oaiq).not.toHaveBeenCalledWith('measure', 'lead_created', expect.anything());
    expect(gtag).not.toHaveBeenCalledWith('event', 'conversion', expect.anything());
    expect((window as any).psConversaoLeadReal).toBeUndefined();
    expect((window as any).psConversaoOrcamento).toBeUndefined();
  });
});
