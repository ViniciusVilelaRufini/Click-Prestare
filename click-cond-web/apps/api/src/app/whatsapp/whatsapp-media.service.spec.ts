import { Readable } from 'node:stream';
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
    const service = new WhatsappMediaService(graph as any, s3 as any, { bucket: 'whatsapp-private' });

    await expect(service.guardarEntrada({
      wamid: 'wamid.exe', tipo: 'application/x-msdownload', mediaId: 'media-exe',
    })).rejects.toThrow('Tipo de mídia não permitido');

    expect(graph.obterMidia).not.toHaveBeenCalled();
    expect(graph.baixarMidia).not.toHaveBeenCalled();
    expect(s3.send).not.toHaveBeenCalled();
  });
});
