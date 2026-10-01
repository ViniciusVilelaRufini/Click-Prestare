import { Readable, Writable } from 'node:stream';
import { WhatsappMediaService } from './whatsapp-media.service';

describe('WhatsappMediaService', () => {
  const graph = {
    obterMidia: jest.fn(),
    baixarMidia: jest.fn(),
  };
  const s3 = { send: jest.fn() };

  beforeEach(() => jest.resetAllMocks());

  it('persists inbound audio under a non-public whatsapp wamid UUID key', async () => {
    graph.obterMidia.mockResolvedValue({
      mime: 'audio/ogg; codecs=opus',
      nome: undefined,
      tamanho: 12,
    });
    graph.baixarMidia.mockResolvedValue(Readable.from([Buffer.from('audio')]));
    s3.send.mockResolvedValue({});
    const service = new WhatsappMediaService(graph as any, s3 as any, {
      bucket: 'whatsapp-private',
      maxBytes: 1024,
    });

    const saved = await service.guardarEntrada({ wamid: 'wamid.inbound.1', tipo: 'audio', mediaId: 'media-1' });

    expect(saved).toEqual(expect.objectContaining({
      chave: expect.stringMatching(/^whatsapp\/wamid\.inbound\.1\/[0-9a-f-]{36}$/),
      mime: 'audio/ogg',
      nome: null,
      tamanho: 12,
      status: 'armazenada',
    }));
    expect(graph.baixarMidia).toHaveBeenCalledWith('media-1');
    const comando = s3.send.mock.calls[0][0];
    expect(comando.input).toEqual(expect.objectContaining({
      Bucket: 'whatsapp-private',
      ContentType: 'audio/ogg',
    }));
    expect(comando.input.ACL).not.toBe('public-read');
  });

  it('rejects executable MIME before calling Graph or S3', async () => {
    graph.obterMidia.mockResolvedValue({ mime: 'application/x-msdownload', tamanho: 12 });
    const service = new WhatsappMediaService(graph as any, s3 as any, { bucket: 'whatsapp-private' });

    await expect(service.guardarEntrada({
      wamid: 'wamid.exe', tipo: 'document', mediaId: 'media-exe',
    })).rejects.toThrow('Tipo de mídia não permitido');

    expect(graph.obterMidia).toHaveBeenCalledWith('media-exe');
    expect(graph.baixarMidia).not.toHaveBeenCalled();
    expect(s3.send).not.toHaveBeenCalled();
  });

  it('accepts text documents but rejects image MIME in the document category', async () => {
    graph.obterMidia.mockResolvedValueOnce({ mime: 'text/plain', tamanho: 4 });
    graph.baixarMidia.mockResolvedValueOnce(Readable.from([Buffer.from('nota')]));
    s3.send.mockResolvedValueOnce({});
    const service = new WhatsappMediaService(graph as any, s3 as any, { bucket: 'whatsapp-private' });

    await expect(service.guardarEntrada({ wamid: 'wamid.txt', tipo: 'document', mediaId: 'media-txt' }))
      .resolves.toEqual(expect.objectContaining({ mime: 'text/plain' }));

    graph.obterMidia.mockResolvedValueOnce({ mime: 'image/jpeg', tamanho: 4 });
    await expect(service.guardarEntrada({ wamid: 'wamid.jpg', tipo: 'document', mediaId: 'media-jpg' }))
      .rejects.toThrow('Tipo de mídia não permitido');
    expect(graph.baixarMidia).toHaveBeenCalledTimes(1);
  });

  it('returns unavailable without calling Graph or S3 when media storage is not configured', async () => {
    const service = new WhatsappMediaService(graph as any, s3 as any, {});

    await expect(service.guardarEntrada({ wamid: 'wamid.none', tipo: 'audio', mediaId: 'media-none' }))
      .resolves.toEqual({ chave: null, mime: null, nome: null, tamanho: null, status: 'indisponivel' });
    expect(graph.obterMidia).not.toHaveBeenCalled();
    expect(s3.send).not.toHaveBeenCalled();
  });

  it('rejects a download stream that exceeds the configured byte limit', async () => {
    graph.obterMidia.mockResolvedValue({ mime: 'audio/ogg', tamanho: 4 });
    graph.baixarMidia.mockResolvedValue(Readable.from([Buffer.alloc(5)]));
    s3.send.mockImplementation(async (command: any) => {
      for await (const _chunk of command.input.Body) { /* consume the upload stream */ }
    });
    const service = new WhatsappMediaService(graph as any, s3 as any, { bucket: 'whatsapp-private', maxBytes: 4 });

    await expect(service.guardarEntrada({ wamid: 'wamid.large', tipo: 'audio', mediaId: 'media-large' }))
      .rejects.toThrow('Mídia excede o limite permitido');
  });

  it('aborts a Smithy-style Node upload and rejects promptly when the stream overflows', async () => {
    graph.obterMidia.mockResolvedValue({ mime: 'audio/ogg', tamanho: 4 });
    graph.baixarMidia.mockResolvedValue(Readable.from([Buffer.alloc(4), Buffer.alloc(1)]));
    let abortou = false;
    s3.send.mockImplementation((command: any, options: any) => new Promise((_resolve, reject) => {
      // The Smithy Node handler pipes the body to an HTTP request; body errors
      // alone do not reject this promise. Only aborting the request does.
      const request = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
      command.input.Body.on('error', () => undefined);
      command.input.Body.pipe(request);
      options?.abortSignal?.addEventListener('abort', () => {
        abortou = true;
        reject(new Error('request aborted'));
      }, { once: true });
    }));
    const service = new WhatsappMediaService(graph as any, s3 as any, { bucket: 'whatsapp-private', maxBytes: 4 });
    const resultado = service.guardarEntrada({ wamid: 'wamid.abort', tipo: 'audio', mediaId: 'media-abort' });
    const dentroDoPrazo = Promise.race([
      resultado,
      new Promise((_, reject) => setTimeout(() => reject(new Error('upload timeout')), 100)),
    ]);

    await expect(dentroDoPrazo).rejects.toThrow('Mídia excede o limite permitido');
    expect(abortou).toBe(true);
  });
});
