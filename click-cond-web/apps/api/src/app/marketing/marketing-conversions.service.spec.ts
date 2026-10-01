import { MarketingConversionsService } from './marketing-conversions.service';

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
    const service = new MarketingConversionsService();
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
    const service = new MarketingConversionsService();
    fetchSpy.mockImplementation(resposta as any);

    await expect(service.confirmarLeadWhatsApp({
      wamid: 'wamid-falha', em: new Date('2026-09-30T12:00:00.000Z'),
      lead: { origem: 'openai', oppref: 'op-1' } as any,
    })).resolves.toBeUndefined();
  });

  it('does not post for organic, Google, missing oppref, or missing API key', async () => {
    const service = new MarketingConversionsService();
    const now = new Date('2026-09-30T12:00:00.000Z');

    await service.confirmarLeadWhatsApp({ wamid: 'organic', em: now, lead: { origem: 'organico', oppref: 'op-1' } as any });
    await service.confirmarLeadWhatsApp({ wamid: 'google', em: now, lead: { origem: 'google', oppref: 'op-1' } as any });
    await service.confirmarLeadWhatsApp({ wamid: 'no-oppref', em: now, lead: { origem: 'openai', oppref: '  ' } as any });
    delete process.env.OPENAI_ADS_CONVERSIONS_API_KEY;
    await service.confirmarLeadWhatsApp({ wamid: 'no-key', em: now, lead: { origem: 'openai', oppref: 'op-1' } as any });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
