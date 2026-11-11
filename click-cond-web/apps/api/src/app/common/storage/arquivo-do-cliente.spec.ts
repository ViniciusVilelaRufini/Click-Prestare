import { BadRequestException } from '@nestjs/common';
import { StorageService } from './storage.service';

/**
 * O bucket é privado e a API devolve link assinado para qualquer URL dele que
 * esteja numa resposta. Se o cliente pudesse gravar uma URL do bucket qualquer
 * num campo de arquivo (a foto do próprio perfil, por exemplo), quem guardou a
 * URL de um arquivo alheio — um ex-porteiro — ganharia link novo para sempre.
 *
 * Regra: campo de arquivo vindo do cliente aceita data URL nova (vira upload),
 * a MESMA chave já gravada naquela entidade ou vazio. Outra URL do bucket é
 * recusada. URL fora do bucket segue a regra de cada campo.
 */
describe('StorageService.exigirArquivoDoRegistro', () => {
  const BUCKET = 'prestare-arquivos-teste';
  const BASE = `https://${BUCKET}.s3.sa-east-1.amazonaws.com`;
  const MINHA = `${BASE}/sindicos/1700000000000-minha.jpg`;
  const ALHEIA = `${BASE}/moradores/1700000000000-alheia.jpg`;
  const ambienteOriginal = { ...process.env };

  function criar() {
    process.env.AWS_ACCESS_KEY_ID = 'AKIAEXEMPLOEXEMPLO00';
    process.env.AWS_SECRET_ACCESS_KEY = 'segredo-de-teste-que-nao-existe-na-aws';
    process.env.AWS_S3_BUCKET_NAME = BUCKET;
    process.env.AWS_S3_BASE_URL = BASE;
    process.env.AWS_S3_BUCKET_REGION = 'sa-east-1';
    for (const k of ['R2_ACCESS_KEY_ID', 'R2_BUCKET', 'R2_PUBLIC_URL', 'R2_ENDPOINT']) delete process.env[k];
    return new StorageService();
  }

  afterEach(() => {
    process.env = { ...ambienteOriginal };
  });

  it('URL do bucket que não é a gravada na entidade: 400 "Arquivo inválido."', async () => {
    const storage = criar();
    const erro = await storage.exigirArquivoDoRegistro(ALHEIA, [MINHA]).catch((e) => e);
    expect(erro).toBeInstanceOf(BadRequestException);
    expect(erro.message).toBe('Arquivo inválido.');
  });

  it('sem nada gravado (cadastro novo), qualquer URL do bucket é recusada', async () => {
    const storage = criar();
    await expect(storage.exigirArquivoDoRegistro(MINHA, [])).rejects.toBeInstanceOf(BadRequestException);
    await expect(storage.exigirArquivoDoRegistro(MINHA, [null, undefined, ''])).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('a MESMA chave já gravada passa — canônica, assinada ou por outro host S3 do bucket', async () => {
    const storage = criar();
    const assinada = await storage.assinarUrl(MINHA);
    expect(assinada).not.toBe(MINHA);
    await expect(storage.exigirArquivoDoRegistro(MINHA, [MINHA])).resolves.toBeUndefined();
    await expect(storage.exigirArquivoDoRegistro(assinada, [MINHA])).resolves.toBeUndefined();
    await expect(
      storage.exigirArquivoDoRegistro(`https://${BUCKET}.s3.amazonaws.com/sindicos/1700000000000-minha.jpg`, [assinada]),
    ).resolves.toBeUndefined();
  });

  it('a chave é comparada pelo caminho: query string ou fragmento não trocam o arquivo', async () => {
    const storage = criar();
    await expect(storage.exigirArquivoDoRegistro(`${MINHA}?v=2#x`, [MINHA])).resolves.toBeUndefined();
    await expect(storage.exigirArquivoDoRegistro(`${ALHEIA}?v=2`, [MINHA])).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('data URL, vazio e URL fora do bucket (inclusive o bucket antigo) não são da conta desta regra', async () => {
    const storage = criar();
    for (const v of [
      'data:image/png;base64,iVBORw0KGgo=',
      '',
      null,
      undefined,
      'https://exemplo.com/foto.jpg',
      'https://storage-click-dev.s3.amazonaws.com/moradores/a.jpg',
    ]) {
      await expect(storage.exigirArquivoDoRegistro(v, [])).resolves.toBeUndefined();
    }
  });

  it('o que está gravado só é carregado quando o valor é URL do bucket', async () => {
    const storage = criar();
    const carregar = jest.fn(async () => [MINHA]);
    await storage.exigirArquivoDoRegistro('data:image/png;base64,iVBORw0KGgo=', carregar);
    await storage.exigirArquivoDoRegistro('https://exemplo.com/foto.jpg', carregar);
    expect(carregar).not.toHaveBeenCalled();

    await storage.exigirArquivoDoRegistro(MINHA, carregar);
    expect(carregar).toHaveBeenCalledTimes(1);
    await expect(storage.exigirArquivoDoRegistro(ALHEIA, carregar)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ehArquivoDoBucket reconhece só URL do nosso bucket', () => {
    const storage = criar();
    expect(storage.ehArquivoDoBucket(MINHA)).toBe(true);
    expect(storage.ehArquivoDoBucket(`${MINHA}?X-Amz-Signature=abc`)).toBe(true);
    expect(storage.ehArquivoDoBucket('https://exemplo.com/foto.jpg')).toBe(false);
    expect(storage.ehArquivoDoBucket('data:image/png;base64,AAAA')).toBe(false);
    expect(storage.ehArquivoDoBucket(null)).toBe(false);
  });
});
