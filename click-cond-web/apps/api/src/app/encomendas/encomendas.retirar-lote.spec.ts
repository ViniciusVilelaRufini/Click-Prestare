import { BadRequestException } from '@nestjs/common';
import { StorageService } from '../common/storage/storage.service';
import { EncomendasService } from './encomendas.service';

/**
 * Retirada em lote na portaria-web: a 1ª encomenda sobe a assinatura e a foto
 * (data URL); as seguintes reaproveitam a URL do bucket que a 1ª devolveu.
 * A chave vale para outra encomenda do MESMO condomínio retirada há no máximo
 * 15 minutos; fora disso continua 400 "Arquivo inválido.".
 */
describe('EncomendasService.retirar — lote reaproveitando a assinatura da 1ª', () => {
  const BUCKET = 'prestare-arquivos-teste';
  const BASE = `https://${BUCKET}.s3.sa-east-1.amazonaws.com`;
  const ASSINATURA = `${BASE}/encomendas/1800000000000-assinatura.png`;
  const FOTO = `${BASE}/encomendas/1800000000000-foto.jpg`;
  const ASSINATURA_ASSINADA = `${ASSINATURA}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc`;
  const porteiro: any = { sub: 3, nome: 'Porteiro', id_condominio: 1 };
  const ambienteOriginal = { ...process.env };

  function storageReal() {
    process.env.AWS_ACCESS_KEY_ID = 'AKIAEXEMPLOEXEMPLO00';
    process.env.AWS_SECRET_ACCESS_KEY = 'segredo-de-teste-que-nao-existe-na-aws';
    process.env.AWS_S3_BUCKET_NAME = BUCKET;
    process.env.AWS_S3_BASE_URL = BASE;
    process.env.AWS_S3_BUCKET_REGION = 'sa-east-1';
    for (const k of ['R2_ACCESS_KEY_ID', 'R2_BUCKET', 'R2_PUBLIC_URL', 'R2_ENDPOINT']) delete process.env[k];
    const storage = new StorageService();
    jest
      .spyOn(storage, 'uploadDataUrl')
      .mockImplementation(async (dataUrl: string) => (dataUrl.startsWith('data:image/png') ? ASSINATURA : FOTO));
    return storage;
  }

  afterEach(() => {
    process.env = { ...ambienteOriginal };
    jest.restoreAllMocks();
  });

  /** Banco em memória com o mínimo de `where` que o retirar usa. */
  function build(registros: any[]) {
    const tabela = new Map<number, any>(registros.map((r) => [r.id, { ...r }]));
    const casa = (r: any, where: any): boolean =>
      Object.entries(where ?? {}).every(([campo, cond]: [string, any]) => {
        if (campo === 'OR') return (cond as any[]).some((w) => casa(r, w));
        if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
          if ('not' in cond) return r[campo] !== cond.not;
          if ('gte' in cond) return r[campo] instanceof Date && r[campo].getTime() >= cond.gte.getTime();
          if ('in' in cond) return cond.in.includes(r[campo]);
        }
        return r[campo] === cond;
      });
    const prisma: any = {
      isConnected: true,
      encomendas: {
        findUnique: jest.fn(async ({ where }: any) => {
          const r = tabela.get(Number(where.id));
          return r ? { ...r } : null;
        }),
        findFirst: jest.fn(async ({ where }: any) => [...tabela.values()].find((r) => casa(r, where)) ?? null),
        findMany: jest.fn(async ({ where }: any) => [...tabela.values()].filter((r) => casa(r, where))),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const alvos = [...tabela.values()].filter((r) => casa(r, where));
          for (const r of alvos) Object.assign(r, data);
          return { count: alvos.length };
        }),
      },
    };
    const tenant: any = { assertEntidade: jest.fn(async () => undefined) };
    const service = new EncomendasService(prisma, {} as any, storageReal(), { registrar: jest.fn() } as any, tenant);
    return { service, prisma, tabela };
  }

  const aguardando = (id: number, id_condominio = 1) => ({
    id,
    id_condominio,
    descricao: `Caixa ${id}`,
    destinatario_apto: '12',
    status: 'Aguardando',
    retirado_em: null,
    retirado_assinatura: null,
    retirado_foto: null,
  });

  async function arquivoInvalido(p: Promise<unknown>) {
    const erro: any = await p.catch((e) => e);
    expect(erro).toBeInstanceOf(BadRequestException);
    expect(erro.message).toBe('Arquivo inválido.');
  }

  it('lote de 3 encomendas reaproveitando a URL da 1ª: todas retiradas', async () => {
    const { service, tabela } = build([aguardando(1), aguardando(2), aguardando(3)]);

    await service.retirar(1, 'Ana', '123', 'data:image/png;base64,AAAA', 'data:image/jpeg;base64,BBBB', porteiro);
    await service.retirar(2, 'Ana', '123', ASSINATURA_ASSINADA, FOTO, porteiro);
    await service.retirar(3, 'Ana', '123', ASSINATURA, FOTO, porteiro);

    for (const id of [1, 2, 3]) {
      expect(tabela.get(id).status).toBe('Retirada');
      expect(tabela.get(id).retirado_foto).toBe(FOTO);
    }
  });

  it('URL de encomenda retirada em outro condomínio: 400', async () => {
    const outra = { ...aguardando(9, 2), status: 'Retirada', retirado_em: new Date(), retirado_assinatura: ASSINATURA, retirado_foto: FOTO };
    const { service, tabela } = build([outra, aguardando(2)]);

    await arquivoInvalido(service.retirar(2, 'Ana', undefined, ASSINATURA, undefined, porteiro));
    await arquivoInvalido(service.retirar(2, 'Ana', undefined, undefined, FOTO, porteiro));
    expect(tabela.get(2).status).toBe('Aguardando');
  });

  it('URL de encomenda retirada há mais de 15 minutos: 400', async () => {
    const antiga = {
      ...aguardando(9),
      status: 'Retirada',
      retirado_em: new Date(Date.now() - 16 * 60_000),
      retirado_assinatura: ASSINATURA,
      retirado_foto: FOTO,
    };
    const { service, tabela } = build([antiga, aguardando(2)]);

    await arquivoInvalido(service.retirar(2, 'Ana', undefined, ASSINATURA, undefined, porteiro));
    await arquivoInvalido(service.retirar(2, 'Ana', undefined, undefined, FOTO, porteiro));
    expect(tabela.get(2).status).toBe('Aguardando');
  });
});
