import { MarketingConversionsService } from './marketing-conversions.service';

const segredosEnv = { obter: async (nome: string) => process.env[nome] } as any;

describe('MarketingConversionsService', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;
  const fetchSpy = jest.fn();

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      OPENAI_ADS_PIXEL_ID: 'pixel-1',
      OPENAI_ADS_CONVERSIONS_API_KEY: 'key-1',
    };
    fetchSpy.mockReset();
    (global as any).fetch = fetchSpy;
  });

  afterAll(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  it('posts one OpenAI offline lead_created event with oppref and wamid', async () => {
    const service = new MarketingConversionsService(segredosEnv);
    const now = new Date('2026-09-30T12:00:00.000Z');
    fetchSpy.mockResolvedValue({ ok: true });

    await service.confirmarLeadWhatsApp({
      wamid: 'wamid-1', em: now,
      lead: { origem: 'openai', oppref: 'op-1', gclid: null, pagina: '/sobre' } as any,
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://bzr.openai.com/v1/events?pid=pixel-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          events: [{ id: 'wamid-1', type: 'lead_created', timestamp_ms: now.getTime(), oppref: 'op-1', action_source: 'offline', data: { type: 'customer_action' } }],
        }),
      }),
    );
  });

  it.each([
    ['a non-OK response', () => ({ ok: false, status: 422 })],
    ['a rejected request', () => Promise.reject(new Error('offline'))],
  ])('does not reject the WhatsApp flow after %s', async (_description, resposta) => {
    const service = new MarketingConversionsService(segredosEnv);
    fetchSpy.mockImplementation(resposta as any);

    await expect(service.confirmarLeadWhatsApp({
      wamid: 'wamid-falha', em: new Date('2026-09-30T12:00:00.000Z'),
      lead: { origem: 'openai', oppref: 'op-1' } as any,
    })).resolves.toBeUndefined();
  });

  it('does not post for organic, Google, missing oppref, or missing API key', async () => {
    const service = new MarketingConversionsService(segredosEnv);
    const now = new Date('2026-09-30T12:00:00.000Z');

    await service.confirmarLeadWhatsApp({ wamid: 'organic', em: now, lead: { origem: 'organico', oppref: 'op-1' } as any });
    await service.confirmarLeadWhatsApp({ wamid: 'google', em: now, lead: { origem: 'google', oppref: 'op-1' } as any });
    await service.confirmarLeadWhatsApp({ wamid: 'no-oppref', em: now, lead: { origem: 'openai', oppref: '  ' } as any });
    delete process.env.OPENAI_ADS_CONVERSIONS_API_KEY;
    await service.confirmarLeadWhatsApp({ wamid: 'no-key', em: now, lead: { origem: 'openai', oppref: 'op-1' } as any });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('lê pixel e chave do crm_config quando a env não tem', async () => {
    delete process.env.OPENAI_ADS_PIXEL_ID;
    delete process.env.OPENAI_ADS_CONVERSIONS_API_KEY;
    const valores: Record<string, string> = { OPENAI_ADS_PIXEL_ID: 'pixel-db', OPENAI_ADS_CONVERSIONS_API_KEY: 'key-db' };
    const service = new MarketingConversionsService({ obter: async (nome: string) => valores[nome] } as any);
    fetchSpy.mockResolvedValue({ ok: true });

    await service.confirmarLeadWhatsApp({
      wamid: 'w', em: new Date('2026-11-07T12:00:00.000Z'),
      lead: { origem: 'openai', oppref: 'op', gclid: null, pagina: '/sobre' } as any,
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://bzr.openai.com/v1/events?pid=pixel-db',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer key-db' }) }),
    );
  });
});
