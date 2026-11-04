import { PutObjectCommand } from '@aws-sdk/client-s3';
import { StorageService } from './storage.service';

/**
 * Fotos de rosto (biometria, dado sensível na LGPD), documentos e comprovantes
 * eram gravados com ACL public-read: uma URL que vazasse (push, WhatsApp, log,
 * print) abria o arquivo para sempre. O bucket passa a ser privado e a API
 * entrega links assinados que expiram.
 */
describe('StorageService — bucket privado com links temporários', () => {
  const BASE = 'https://bucket-teste.s3.amazonaws.com';
  const URL_CANONICA = `${BASE}/moradores/1700000000000-abc.jpg`;
  const ambienteOriginal = { ...process.env };

  function criar() {
    process.env.AWS_ACCESS_KEY_ID = 'AKIAEXEMPLOEXEMPLO00';
    process.env.AWS_SECRET_ACCESS_KEY = 'segredo-de-teste-que-nao-existe-na-aws';
    process.env.AWS_S3_BUCKET_NAME = 'bucket-teste';
    process.env.AWS_S3_BASE_URL = `${BASE}/`;
    process.env.AWS_S3_BUCKET_REGION = 'us-east-1';
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_BUCKET;
    delete process.env.R2_PUBLIC_URL;
    delete process.env.R2_ENDPOINT;
    return new StorageService();
  }

  afterEach(() => {
    jest.useRealTimers();
    process.env = { ...ambienteOriginal };
  });

  it('upload não pede mais ACL pública', async () => {
    const storage = criar();
    const send = jest.fn().mockResolvedValue({});
    (storage as any).client.send = send;

    await storage.uploadDataUrl('data:image/png;base64,iVBORw0KGgo=', 'moradores');

    const comando = send.mock.calls[0][0] as PutObjectCommand;
    expect(comando).toBeInstanceOf(PutObjectCommand);
    expect(comando.input.ACL).toBeUndefined();
  });

  it('assina a URL do nosso bucket com validade de 1 hora', async () => {
    const storage = criar();
    const assinada = await storage.assinarUrl(URL_CANONICA);

    const u = new URL(assinada);
    expect(u.pathname).toBe('/moradores/1700000000000-abc.jpg');
    expect(u.searchParams.get('X-Amz-Signature')).toBeTruthy();
    expect(u.searchParams.get('X-Amz-Expires')).toBe(String(60 * 60));
  });

  it('o link é o mesmo dentro da janela de 15 min (cache de imagem continua valendo)', async () => {
    const storage = criar();
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(new Date('2026-10-20T09:15:00Z'));
    const inicio = await storage.assinarUrl(URL_CANONICA);
    jest.setSystemTime(new Date('2026-10-20T09:29:59Z'));
    const fim = await storage.assinarUrl(URL_CANONICA);
    jest.setSystemTime(new Date('2026-10-20T09:30:00Z'));
    const proxima = await storage.assinarUrl(URL_CANONICA);

    expect(fim).toBe(inicio);
    expect(proxima).not.toBe(inicio);
    expect(new URL(inicio).searchParams.get('X-Amz-Date')).toBe('20261020T091500Z');
  });

  it('não mexe em URL de outro host nem em data URL', async () => {
    const storage = criar();
    expect(await storage.assinarUrl('https://exemplo.com/foto.jpg')).toBe('https://exemplo.com/foto.jpg');
    expect(await storage.assinarUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
  });

  it('assinar uma URL já assinada não acumula assinatura', async () => {
    const storage = criar();
    const uma = await storage.assinarUrl(URL_CANONICA);
    const duas = await storage.assinarUrl(uma);
    expect(new URL(duas).searchParams.getAll('X-Amz-Signature')).toHaveLength(1);
  });

  it('normaliza a URL assinada que o cliente devolve para a forma canônica', async () => {
    const storage = criar();
    const assinada = await storage.assinarUrl(URL_CANONICA);
    expect(storage.normalizarUrl(assinada)).toBe(URL_CANONICA);
    // Variante regional do host, que o SDK também gera.
    expect(
      storage.normalizarUrl('https://bucket-teste.s3.us-east-1.amazonaws.com/moradores/1700000000000-abc.jpg?X-Amz-Signature=x'),
    ).toBe(URL_CANONICA);
    expect(storage.normalizarUrl('https://exemplo.com/a.jpg?x=1')).toBe('https://exemplo.com/a.jpg?x=1');
  });

  it('com o storage desativado devolve a URL como está', async () => {
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_ACCESS_KEY;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_SECRET_KEY;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
    const storage = new StorageService();
    expect(await storage.assinarUrl(URL_CANONICA)).toBe(URL_CANONICA);
  });

  describe('bucket novo (prestare-arquivos) com URLs antigas no banco', () => {
    const NOVO = 'prestare-arquivos-850401152034';
    const BASE_NOVA = `https://${NOVO}.s3.sa-east-1.amazonaws.com`;
    const ANTIGA = 'https://storage-click-dev.s3.amazonaws.com/moradores/1700000000000-abc.jpg';

    function criarNovo() {
      criar();
      process.env.AWS_S3_BUCKET_NAME = NOVO;
      process.env.AWS_S3_BASE_URL = BASE_NOVA;
      process.env.AWS_S3_BUCKET_REGION = 'sa-east-1';
      return new StorageService();
    }

    it('URL do bucket antigo sai intacta (nem assina, nem normaliza)', async () => {
      const storage = criarNovo();
      expect(await storage.assinarUrl(ANTIGA)).toBe(ANTIGA);
      expect(storage.normalizarUrl(ANTIGA)).toBe(ANTIGA);
    });

    it('URL do bucket novo é assinada', async () => {
      const storage = criarNovo();
      const assinada = await storage.assinarUrl(`${BASE_NOVA}/moradores/x.jpg`);
      const u = new URL(assinada);
      expect(u.host).toBe(`${NOVO}.s3.sa-east-1.amazonaws.com`);
      expect(u.pathname).toBe('/moradores/x.jpg');
      expect(u.searchParams.get('X-Amz-Signature')).toBeTruthy();
    });

    it('upload não fixa criptografia (vale o padrão SSE-KMS do bucket)', async () => {
      const storage = criarNovo();
      const send = jest.fn().mockResolvedValue({});
      (storage as any).client.send = send;
      const url = await storage.uploadDataUrl('data:image/png;base64,iVBORw0KGgo=', 'moradores');
      const input = (send.mock.calls[0][0] as PutObjectCommand).input;
      expect(input.ServerSideEncryption).toBeUndefined();
      expect(input.SSEKMSKeyId).toBeUndefined();
      expect(url?.startsWith(`${BASE_NOVA}/moradores/`)).toBe(true);
    });

    it('deleteUrl apaga pela URL do bucket novo (canônica ou assinada), respeitando a pasta do dono', async () => {
      const storage = criarNovo();
      const send = jest.fn().mockResolvedValue({});
      (storage as any).client.send = send;

      expect(await storage.deleteUrl(`${BASE_NOVA}/moradores/x.jpg`, ['moradores/'])).toBe(true);
      expect(await storage.deleteUrl(`${BASE_NOVA}/moradores/y.jpg?X-Amz-Signature=abc`, ['moradores/'])).toBe(true);
      expect(send.mock.calls.map((c) => c[0].input.Key)).toEqual(['moradores/x.jpg', 'moradores/y.jpg']);
      expect(send.mock.calls[0][0].input.Bucket).toBe(NOVO);

      expect(await storage.deleteUrl(`${BASE_NOVA}/convites/z.jpg`, ['moradores/'])).toBe(false);
      expect(await storage.deleteUrl(`${BASE_NOVA}/moradores/%2e%2e/segredo`, ['moradores/'])).toBe(false);
      expect(send).toHaveBeenCalledTimes(2);
    });

    it('deleteUrl nunca apaga objeto do bucket antigo', async () => {
      const storage = criarNovo();
      const send = jest.fn().mockResolvedValue({});
      (storage as any).client.send = send;
      expect(await storage.deleteUrl(ANTIGA, ['moradores/'])).toBe(false);
      expect(send).not.toHaveBeenCalled();
    });
  });
});
