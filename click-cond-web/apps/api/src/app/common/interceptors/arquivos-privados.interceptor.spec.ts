import { Logger, StreamableFile } from '@nestjs/common';
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
    ehArquivoDoBucket: jest.fn((u: unknown) => typeof u === 'string' && u.startsWith('https://bucket.s3.amazonaws.com/')),
  };
  beforeEach(() => jest.clearAllMocks());

  function executar(resposta: unknown, body?: unknown) {
    const req: any = { body, method: 'GET', route: { path: '/ocorrencias' } };
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

  describe('só chaves de arquivo são assinadas (texto livre com URL do bucket não vira link)', () => {
    // Antes, qualquer string do bucket em qualquer chave era assinada: um morador
    // gravava a URL guardada de um arquivo alheio na `descricao` da ocorrência
    // (ou no nome do visitante) e recebia o link assinado de volta.
    let aviso: jest.SpyInstance;
    beforeEach(() => {
      aviso = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });
    afterEach(() => aviso.mockRestore());

    it('chave de texto com URL do bucket sai como está e gera aviso (sem a URL)', async () => {
      const { saida } = executar({ descricao: NOSSA, nome: NOSSA, link: NOSSA, mensagem: NOSSA });
      expect(await saida).toEqual({ descricao: NOSSA, nome: NOSSA, link: NOSSA, mensagem: NOSSA });
      expect(storage.assinarUrl).not.toHaveBeenCalledWith(NOSSA);
      expect(aviso).toHaveBeenCalled();
      const textos = aviso.mock.calls.map((c) => String(c[0]));
      expect(textos.some((t) => t.includes('descricao') && t.includes('GET /ocorrencias'))).toBe(true);
      expect(textos.every((t) => !t.includes(NOSSA))).toBe(true);
    });

    it('o aviso é amostrado: uma vez por chave a cada hora', async () => {
      const interceptor = new ArquivosPrivadosInterceptor(storage as any);
      const ctx: any = { getType: () => 'http', switchToHttp: () => ({ getRequest: () => ({ method: 'GET', route: { path: '/x' } }) }) };
      const rodar = (corpo: unknown) => lastValueFrom(interceptor.intercept(ctx, { handle: () => of(corpo) }));
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      try {
        jest.setSystemTime(new Date('2026-11-11T10:00:00Z'));
        await rodar({ observacoes: NOSSA });
        await rodar({ observacoes: NOSSA });
        expect(aviso).toHaveBeenCalledTimes(1);
        await rodar({ outra_chave: NOSSA });
        expect(aviso).toHaveBeenCalledTimes(2);
        jest.setSystemTime(new Date('2026-11-11T11:00:01Z'));
        await rodar({ observacoes: NOSSA });
        expect(aviso).toHaveBeenCalledTimes(3);
      } finally {
        jest.useRealTimers();
      }
    });

    it('string solta (sem chave) do bucket não é assinada', async () => {
      expect(await executar(NOSSA).saida).toBe(NOSSA);
      expect(await executar([NOSSA, 'texto']).saida).toEqual([NOSSA, 'texto']);
    });

    it('todas as chaves de arquivo da lista assinam, em qualquer profundidade e dentro de arrays', async () => {
      const chaves = [
        'photo', 'profile_image', 'foto', 'foto_pessoa', 'foto_documento', 'fotoPessoa', 'fotoDocumento',
        'foto_url', 'imagem', 'foto_volume', 'retirado_foto', 'retirado_assinatura', 'link_doc',
        'url_boleto', 'url_comprovante', 'url',
      ];
      const corpo = Object.fromEntries(chaves.map((k) => [k, NOSSA]));
      const saida: any = await executar({ dados: { lista: [corpo] }, fotos: { foto: [NOSSA, NOSSA] } }).saida;
      for (const k of chaves) expect(saida.dados.lista[0][k]).toBe(`${NOSSA}?X-Amz-Signature=ok`);
      expect(saida.fotos.foto).toEqual([`${NOSSA}?X-Amz-Signature=ok`, `${NOSSA}?X-Amz-Signature=ok`]);
    });

    it('anexos com várias URLs separadas por ";" assina cada uma', async () => {
      const OUTRA = 'https://bucket.s3.amazonaws.com/assembleias/b.pdf';
      const { saida } = executar({ anexos: `${NOSSA};${OUTRA};https://exemplo.com/c.pdf` });
      expect(await saida).toEqual({
        anexos: `${NOSSA}?X-Amz-Signature=ok;${OUTRA}?X-Amz-Signature=ok;https://exemplo.com/c.pdf`,
      });
    });

    it('objeto { efeito: "abrir_url", valor } vindo de qualquer lugar NÃO é assinado (o botão do boleto já sai assinado pela ferramenta)', async () => {
      // Ex.: gravado pelo cliente dentro de `horarios` de uma área social.
      const { saida } = executar({
        horarios: [{ efeito: 'abrir_url', valor: NOSSA }],
        botoes: [{ rotulo: 'Abrir boleto', efeito: 'abrir_url', valor: NOSSA }],
      });
      const r: any = await saida;
      expect(r.horarios[0].valor).toBe(NOSSA);
      expect(r.botoes[0].valor).toBe(NOSSA);
      expect(storage.assinarUrl).not.toHaveBeenCalled();
    });

    it('valor que começa com data: não é quebrado por ";" nem assinado, mesmo sob chave de arquivo', async () => {
      const contrabando = `data:image/png;base64,AAAA;${NOSSA}`;
      const { saida } = executar({ anexos: contrabando, foto: contrabando });
      expect(await saida).toEqual({ anexos: contrabando, foto: contrabando });
      expect(storage.assinarUrl).not.toHaveBeenCalled();
    });
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
      const saida: any = await lastValueFrom(interceptor.intercept(ctx, { handle: () => of({ photo: antiga, foto_pessoa: nova }) }));

      expect(req.body).toEqual({ foto: antiga, outra: nova });
      expect(saida.photo).toBe(antiga);
      expect(saida.foto_pessoa.startsWith(`${nova}?`)).toBe(true);
      expect(new URL(saida.foto_pessoa).searchParams.get('X-Amz-Signature')).toBeTruthy();
      expect(new URL(saida.foto_pessoa).searchParams.get('X-Amz-Expires')).toBe('3600');
    });
  });
});
