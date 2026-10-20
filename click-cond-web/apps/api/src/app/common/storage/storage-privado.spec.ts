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

  it('assina a URL do nosso bucket com validade de 7 dias', async () => {
    const storage = criar();
    const assinada = await storage.assinarUrl(URL_CANONICA);

    const u = new URL(assinada);
    expect(u.pathname).toBe('/moradores/1700000000000-abc.jpg');
    expect(u.searchParams.get('X-Amz-Signature')).toBeTruthy();
    expect(u.searchParams.get('X-Amz-Expires')).toBe(String(7 * 24 * 60 * 60));
  });

  it('o link é o mesmo durante o dia (cache de imagem continua valendo)', async () => {
    const storage = criar();
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(new Date('2026-10-20T09:15:00Z'));
    const manha = await storage.assinarUrl(URL_CANONICA);
    jest.setSystemTime(new Date('2026-10-20T22:40:00Z'));
    const noite = await storage.assinarUrl(URL_CANONICA);
    jest.setSystemTime(new Date('2026-10-21T00:05:00Z'));
    const diaSeguinte = await storage.assinarUrl(URL_CANONICA);

    expect(noite).toBe(manha);
    expect(diaSeguinte).not.toBe(manha);
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
});
