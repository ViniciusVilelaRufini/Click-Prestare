import { BadRequestException } from '@nestjs/common';
import { PREFIXOS_FOTO_MORADOR, PREFIXOS_FOTO_VISITANTE, StorageService } from './storage.service';

/**
 * exigirArquivoDoRegistro só olhava URL http(s) do bucket; um valor SEM esquema
 * ('moradores/<ms>-<uuid>.jpg', a chave de um objeto de outro condomínio) passava em todo campo de
 * foto, era gravado como veio e, na revogação de biometria (ou na retenção de 90 dias de
 * visitantes), o deleteUrl o tratava como chave crua e apagava o objeto alheio no bucket
 * compartilhado.
 */
describe('StorageService — chave crua do bucket', () => {
  const BUCKET = 'prestare-arquivos-teste';
  const BASE = `https://${BUCKET}.s3.sa-east-1.amazonaws.com`;
  const ALHEIA = 'moradores/1700000000000-0000-alheia.jpg';
  const MINHA_KEY = 'moradores/1700000000000-0000-minha.jpg';
  const MINHA = `${BASE}/${MINHA_KEY}`;
  const ambienteOriginal = { ...process.env };

  function criar() {
    process.env.AWS_ACCESS_KEY_ID = 'AKIAEXEMPLOEXEMPLO00';
    process.env.AWS_SECRET_ACCESS_KEY = 'segredo-de-teste-que-nao-existe-na-aws';
    process.env.AWS_S3_BUCKET_NAME = BUCKET;
    process.env.AWS_S3_BASE_URL = BASE;
    process.env.AWS_S3_BUCKET_REGION = 'sa-east-1';
    for (const k of ['R2_ACCESS_KEY_ID', 'R2_BUCKET', 'R2_PUBLIC_URL', 'R2_ENDPOINT']) delete process.env[k];
    const svc: any = new StorageService();
    svc.client = { send: jest.fn().mockResolvedValue({}) };
    return svc as StorageService & { client: { send: jest.Mock } };
  }

  afterEach(() => {
    process.env = { ...ambienteOriginal };
  });

  describe('exigirArquivoDoRegistro', () => {
    it.each([ALHEIA, `/${ALHEIA}`, `${ALHEIA}?v=1`, 'visitantes/1700000000000-0000-x.jpg'])(
      'valor sem esquema que não é o gravado (%s): 400 "Arquivo inválido."',
      async (valor) => {
        const storage = criar();
        const erro = await storage.exigirArquivoDoRegistro(valor, [MINHA]).catch((e) => e);
        expect(erro).toBeInstanceOf(BadRequestException);
        expect(erro.message).toBe('Arquivo inválido.');
        await expect(storage.exigirArquivoDoRegistro(valor, [])).rejects.toBeInstanceOf(BadRequestException);
      },
    );

    it('a mesma chave já gravada passa — gravada como URL do bucket ou como a mesma chave crua', async () => {
      const storage = criar();
      await expect(storage.exigirArquivoDoRegistro(MINHA_KEY, [MINHA])).resolves.toBeUndefined();
      await expect(storage.exigirArquivoDoRegistro(MINHA_KEY, [MINHA_KEY])).resolves.toBeUndefined();
      await expect(storage.exigirArquivoDoRegistro(`/${MINHA_KEY}`, [MINHA_KEY])).resolves.toBeUndefined();
    });

    it('data URL, vazio/espaços e URL fora do bucket seguem fora desta regra', async () => {
      const storage = criar();
      for (const v of ['data:image/png;base64,iVBORw0KGgo=', '', '   ', null, undefined, 'https://exemplo.com/foto.jpg']) {
        await expect(storage.exigirArquivoDoRegistro(v, [])).resolves.toBeUndefined();
      }
    });

    it('as partes de uma data URL dividida por ";" (assembleias/ocorrências) passam', async () => {
      const storage = criar();
      for (const parte of 'data:image/png;base64,iVBORw0KGgo='.split(';')) {
        await expect(storage.exigirArquivoDoRegistro(parte.trim(), [])).resolves.toBeUndefined();
      }
      await expect(storage.exigirArquivoDoRegistro('base64,/9j/4AAQSkZJRg==', [MINHA])).resolves.toBeUndefined();
    });
  });

  describe('deleteUrl', () => {
    it('valor sem esquema NUNCA vira DeleteObject, mesmo dentro da pasta do dono', async () => {
      const storage = criar();
      expect(await storage.deleteUrl(ALHEIA, PREFIXOS_FOTO_MORADOR)).toBe(false);
      expect(await storage.deleteUrl(`/${ALHEIA}`, PREFIXOS_FOTO_MORADOR)).toBe(false);
      expect(await storage.deleteUrl('visitantes/1700000000000-0000-x.jpg', PREFIXOS_FOTO_VISITANTE)).toBe(false);
      expect(storage.client.send).not.toHaveBeenCalled();
    });

    it('URL do nosso bucket dentro da pasta do dono continua sendo apagada', async () => {
      const storage = criar();
      expect(await storage.deleteUrl(MINHA, PREFIXOS_FOTO_MORADOR)).toBe(true);
      expect(storage.client.send.mock.calls[0][0].input.Key).toBe(MINHA_KEY);
    });
  });
});
