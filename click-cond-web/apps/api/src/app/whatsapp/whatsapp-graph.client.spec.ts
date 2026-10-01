import { WhatsappGraphClient } from './whatsapp-graph.client';

describe('WhatsappGraphClient', () => {
  const segredos = { obter: jest.fn(async () => 'tok') } as any;
  afterEach(() => jest.restoreAllMocks());

  it('envia texto e devolve o wamid', async () => {
    const f = jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'wamid.X' }] }) } as any);
    await expect(new WhatsappGraphClient(segredos).enviarTexto('5517999', 'Olá')).resolves.toBe('wamid.X');
    const [url, init] = f.mock.calls[0] as any;
    expect(url).toBe('https://graph.facebook.com/v25.0/1356887267509002/messages');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toEqual({ messaging_product: 'whatsapp', to: '5517999', type: 'text', text: { body: 'Olá', preview_url: false } });
  });

  it('erro do Graph vira exceção com a mensagem', async () => {
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { message: 'Janela expirada' } }) } as any);
    await expect(new WhatsappGraphClient(segredos).enviarTexto('55', 'x')).rejects.toThrow('Janela expirada');
  });

  it('sem token não chama a API', async () => {
    const f = jest.spyOn(global, 'fetch' as any);
    await expect(new WhatsappGraphClient({ obter: async () => undefined } as any).enviarTexto('55', 'x')).rejects.toThrow('WA_ACCESS_TOKEN');
    expect(f).not.toHaveBeenCalled();
  });

  it('faz upload multipart e envia uma imagem pelo id privado do Graph', async () => {
    const f = jest.spyOn(global, 'fetch' as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'media.1' }) } as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [{ id: 'wamid.image.1' }] }) } as any);

    await expect(new WhatsappGraphClient(segredos).enviarMidia({
      para: '5517999', tipo: 'image', legenda: 'A fachada',
      arquivo: { buffer: Buffer.from('png'), mimetype: 'image/png', originalname: 'fachada.png' },
    })).resolves.toBe('wamid.image.1');

    const [uploadUrl, uploadInit] = f.mock.calls[0] as any;
    expect(uploadUrl).toBe('https://graph.facebook.com/v25.0/1356887267509002/media');
    expect(uploadInit.headers).toEqual({ Authorization: 'Bearer tok' });
    expect(uploadInit.body).toBeInstanceOf(FormData);
    expect(uploadInit.body.get('messaging_product')).toBe('whatsapp');
    expect((uploadInit.body.get('file') as File).type).toBe('image/png');
    expect(JSON.parse((f.mock.calls[1] as any)[1].body)).toEqual({
      messaging_product: 'whatsapp', to: '5517999', type: 'image', image: { id: 'media.1', caption: 'A fachada' },
    });
  });

  it('envia video no Graph incluindo type no upload multipart', async () => {
    const f = jest.spyOn(global, 'fetch' as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'media.video.1' }) } as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [{ id: 'wamid.video.1' }] }) } as any);

    const videoBuffer = Buffer.from('mp4-data');
    await expect(new WhatsappGraphClient(segredos).enviarMidia({
      para: '5517999', tipo: 'video', legenda: 'Apresentação',
      arquivo: { buffer: videoBuffer, mimetype: 'video/mp4', originalname: 'anuncio.mp4' },
    })).resolves.toBe('wamid.video.1');

    const [uploadUrl, uploadInit] = f.mock.calls[0] as any;
    expect(uploadInit.body.get('type')).toBe('video/mp4');
    expect(JSON.parse((f.mock.calls[1] as any)[1].body)).toEqual({
      messaging_product: 'whatsapp',
      to: '5517999',
      type: 'video',
      video: {
        id: 'media.video.1',
        caption: 'Apresentação',
      },
    });
  });

  it('baixa midia enviando User-Agent curl e lendo binario em stream', async () => {
    const f = jest.spyOn(global, 'fetch' as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ url: 'https://lookaside.fbsbx.com/midia/audio.ogg' }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'audio/ogg' }),
        arrayBuffer: async () => new TextEncoder().encode('opus-audio-data').buffer,
      } as any);

    const stream = await new WhatsappGraphClient(segredos).baixarMidia('media.audio.123');
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe('opus-audio-data');

    expect(f.mock.calls[0][1].headers['User-Agent']).toBe('curl/7.64.1');
    expect(f.mock.calls[1][1].headers['User-Agent']).toBe('curl/7.64.1');
  });

  it('rejeita download se o lookaside retornar pagina HTML', async () => {
    jest.spyOn(global, 'fetch' as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ url: 'https://lookaside.fbsbx.com/midia/erro' }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        arrayBuffer: async () => Buffer.from('<html>Browser not supported</html>').buffer,
      } as any);

    await expect(new WhatsappGraphClient(segredos).baixarMidia('media.audio.html'))
      .rejects.toThrow('Graph API lookaside retornou HTML ao invés do binário da mídia');
  });
});

