import { S3Client } from '@aws-sdk/client-s3';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
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
      tamanho: 5,
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
      tamanho: 5,
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

  it('does not start a real Smithy Node upload when a delayed byte exceeds the limit', async () => {
    graph.obterMidia.mockResolvedValue({ mime: 'audio/ogg', tamanho: 4 });
    let primeiroEnviado = false;
    graph.baixarMidia.mockResolvedValue(new Readable({
      read() {
        if (primeiroEnviado) return;
        primeiroEnviado = true;
        this.push(Buffer.alloc(4));
        setTimeout(() => { this.push(Buffer.alloc(1)); this.push(null); }, 25);
      },
    }));
    let requisicoes = 0;
    const servidor = createServer((req, res) => {
      requisicoes++;
      req.resume();
      req.on('end', () => { res.statusCode = 200; res.setHeader('etag', '"teste"'); res.end(); });
    });
    await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
    const porta = (servidor.address() as AddressInfo).port;
    const client = new S3Client({
      region: 'us-east-1', endpoint: `http://127.0.0.1:${porta}`, forcePathStyle: true,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
    const service = new WhatsappMediaService(graph as any, client, { bucket: 'whatsapp-private', maxBytes: 4 });

    try {
      await expect(service.guardarEntrada({ wamid: 'wamid.delayed', tipo: 'audio', mediaId: 'media-delayed' }))
        .rejects.toThrow('Mídia excede o limite permitido');
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(requisicoes).toBe(0);
    } finally {
      client.destroy();
      await new Promise<void>((resolve, reject) => servidor.close((erro) => erro ? reject(erro) : resolve()));
    }
  });

  it('pede somente o intervalo validado ao S3 ao abrir mídia privada', async () => {
    s3.send.mockResolvedValue({ Body: Readable.from([Buffer.from('bcd')]), ContentType: 'audio/ogg', ContentLength: 3, ContentRange: 'bytes 1-3/6' });
    const service = new WhatsappMediaService(graph as any, s3 as any, { bucket: 'whatsapp-private' });

    const aberta = await service.abrir('whatsapp/wamid.range/00000000-0000-4000-8000-000000000001', { inicio: 1, fim: 3 });

    expect(s3.send.mock.calls[0][0].input).toMatchObject({ Bucket: 'whatsapp-private', Range: 'bytes=1-3' });
    expect(aberta).toMatchObject({ tamanho: 3, total: 6, inicio: 1, fim: 3 });
  });

  it('reusa a chave determinística do wamid em uma repetição após finalização falhar', async () => {
    graph.obterMidia.mockResolvedValue({ mime: 'audio/ogg', tamanho: 3 });
    graph.baixarMidia.mockResolvedValue(Readable.from([Buffer.from('ogg')]));
    s3.send.mockResolvedValue({});
    const service = new WhatsappMediaService(graph as any, s3 as any, { bucket: 'whatsapp-private' });

    await service.guardarEntrada({ wamid: 'wamid.finalizar', tipo: 'audio', mediaId: 'media-finalizar' });
    await service.guardarEntrada({ wamid: 'wamid.finalizar', tipo: 'audio', mediaId: 'media-finalizar' });

    const chaves = s3.send.mock.calls.map(([comando]: any[]) => comando.input.Key);
    expect(new Set(chaves).size).toBe(1);
  });
});
