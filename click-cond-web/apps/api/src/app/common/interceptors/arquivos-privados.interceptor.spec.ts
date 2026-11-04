import { StreamableFile } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { ArquivosPrivadosInterceptor } from './arquivos-privados.interceptor';
import { StorageService } from '../storage/storage.service';

/**
 * O bucket é privado: toda URL de arquivo que sai da API vira link assinado,
 * e toda URL assinada que o cliente devolve (ao salvar um cadastro) volta à
 * forma canônica antes de chegar no service — senão o banco guardaria um link
 * que expira.
 */
describe('ArquivosPrivadosInterceptor', () => {
  const NOSSA = 'https://bucket.s3.amazonaws.com/moradores/a.jpg';
  const storage = {
    assinarUrl: jest.fn(async (u: string) => (u.startsWith('https://bucket.s3.amazonaws.com/') ? `${u}?X-Amz-Signature=ok` : u)),
    normalizarUrl: jest.fn((u: unknown) => (typeof u === 'string' ? u.split('?')[0] : u)),
  };

  function executar(resposta: unknown, body?: unknown) {
    const req: any = { body };
    const ctx: any = { getType: () => 'http', switchToHttp: () => ({ getRequest: () => req }) };
    const interceptor = new ArquivosPrivadosInterceptor(storage as any);
    return { req, saida: lastValueFrom(interceptor.intercept(ctx, { handle: () => of(resposta) })) };
  }

  it('assina URLs do bucket em qualquer nível da resposta', async () => {
    const { saida } = executar({
      foto_pessoa: NOSSA,
      moradores: [{ photo: NOSSA, nome: 'Ana' }],
      externo: 'https://exemplo.com/x.jpg',
      total: 3,
      ativo: true,
      vazio: null,
    });
    expect(await saida).toEqual({
      foto_pessoa: `${NOSSA}?X-Amz-Signature=ok`,
      moradores: [{ photo: `${NOSSA}?X-Amz-Signature=ok`, nome: 'Ana' }],
      externo: 'https://exemplo.com/x.jpg',
      total: 3,
      ativo: true,
      vazio: null,
    });
  });

  it('assina quando a resposta é a própria string ou uma lista de strings', async () => {
    expect(await executar(NOSSA).saida).toBe(`${NOSSA}?X-Amz-Signature=ok`);
    expect(await executar([NOSSA, 'texto']).saida).toEqual([`${NOSSA}?X-Amz-Signature=ok`, 'texto']);
  });

  it('não toca em arquivos binários nem em datas', async () => {
    const buffer = Buffer.from('xlsx');
    const arquivo = new StreamableFile(Buffer.from('pdf'));
    const data = new Date('2026-10-20T00:00:00Z');
    expect(await executar(buffer).saida).toBe(buffer);
    expect(await executar(arquivo).saida).toBe(arquivo);
    expect(await executar({ criado_em: data }).saida).toEqual({ criado_em: data });
  });

  it('normaliza URLs assinadas do corpo da requisição antes do handler', () => {
    const { req } = executar({}, { foto_pessoa: `${NOSSA}?X-Amz-Signature=velha`, dados: [{ photo: `${NOSSA}?X-Amz-Expires=1` }] });
    expect(req.body).toEqual({ foto_pessoa: NOSSA, dados: [{ photo: NOSSA }] });
  });

  describe('com o StorageService de verdade (bucket novo configurado)', () => {
    const ambienteOriginal = { ...process.env };
    afterAll(() => {
      process.env = { ...ambienteOriginal };
    });

    it('URL do bucket antigo sai intacta e URL do bucket novo sai assinada', async () => {
      process.env.AWS_ACCESS_KEY_ID = 'AKIAEXEMPLOEXEMPLO00';
      process.env.AWS_SECRET_ACCESS_KEY = 'segredo-de-teste-que-nao-existe-na-aws';
      process.env.AWS_S3_BUCKET_NAME = 'prestare-arquivos-850401152034';
      process.env.AWS_S3_BASE_URL = 'https://prestare-arquivos-850401152034.s3.sa-east-1.amazonaws.com';
      process.env.AWS_S3_BUCKET_REGION = 'sa-east-1';
      for (const k of ['R2_ACCESS_KEY_ID', 'R2_BUCKET', 'R2_PUBLIC_URL', 'R2_ENDPOINT']) delete process.env[k];
      const real = new StorageService();

      const antiga = 'https://storage-click-dev.s3.amazonaws.com/moradores/a.jpg';
      const nova = 'https://prestare-arquivos-850401152034.s3.sa-east-1.amazonaws.com/moradores/a.jpg';
      const req: any = { body: { foto: antiga, outra: `${nova}?X-Amz-Signature=velha` } };
      const ctx: any = { getType: () => 'http', switchToHttp: () => ({ getRequest: () => req }) };
      const interceptor = new ArquivosPrivadosInterceptor(real);
      const saida: any = await lastValueFrom(interceptor.intercept(ctx, { handle: () => of({ antiga, nova }) }));

      expect(req.body).toEqual({ foto: antiga, outra: nova });
      expect(saida.antiga).toBe(antiga);
      expect(saida.nova.startsWith(`${nova}?`)).toBe(true);
      expect(new URL(saida.nova).searchParams.get('X-Amz-Signature')).toBeTruthy();
      expect(new URL(saida.nova).searchParams.get('X-Amz-Expires')).toBe('3600');
    });
  });
});
