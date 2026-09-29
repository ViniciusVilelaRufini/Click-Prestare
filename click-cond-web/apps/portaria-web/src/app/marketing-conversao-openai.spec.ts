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

    expect(gtag).toHaveBeenCalledWith('event', 'conversion', expect.any(Object));
    expect(oaiq).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/public/leads'),
      expect.objectContaining({ body: expect.stringContaining('"clique":"whatsapp"') }),
    );
  });

  it('registra lead_created quando o formulário válido é enviado', () => {
    document.body.innerHTML = '';
    const oaiq = jest.fn();
    Object.assign(window, { gtag: jest.fn(), oaiq, fetch: jest.fn(() => Promise.resolve(new Response())) });

    carregarRastreadorDaLanding();

    expect(typeof (window as any).psConversaoLeadReal).toBe('function');
    (window as any).psConversaoLeadReal();

    expect(oaiq).toHaveBeenCalledWith('measure', 'lead_created', { type: 'customer_action' });
  });
});
