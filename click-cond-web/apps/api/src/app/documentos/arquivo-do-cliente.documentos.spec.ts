import { BadRequestException } from '@nestjs/common';
import { DocumentosService } from './documentos.service';
import { AssembleiasService } from '../assembleias/assembleias.service';
import { StorageService } from '../common/storage/storage.service';

/**
 * `link_doc` aceitava qualquer URL: um síndico publicava como "documento" do
 * condomínio dele a URL de um arquivo de outro prédio (que a API passava a
 * assinar em toda listagem) e o indexador do chat ainda baixava o PDF para o
 * índice do condomínio de quem pediu. Mesma regra dos outros campos de
 * arquivo: data URL nova vira upload, a mesma chave já gravada, ou vazio.
 */
describe('documentos e assembleias — arquivos recebidos do cliente', () => {
  const BUCKET = 'prestare-arquivos-teste';
  const BASE = `https://${BUCKET}.s3.sa-east-1.amazonaws.com`;
  const ALHEIO = `${BASE}/documentos/1700000000000-de-outro-predio.pdf`;
  const ANEXO = `${BASE}/assembleias/1700000000000-edital.pdf`;
  const NOVO = `${BASE}/documentos/1800000000000-novo.pdf`;
  const DATA_URL = 'data:application/pdf;base64,JVBERi0xLjQK';
  const sindico: any = { sub: 7, typeAccess: 'Sindico' };
  const ambienteOriginal = { ...process.env };

  function storageReal() {
    process.env.AWS_ACCESS_KEY_ID = 'AKIAEXEMPLOEXEMPLO00';
    process.env.AWS_SECRET_ACCESS_KEY = 'segredo-de-teste-que-nao-existe-na-aws';
    process.env.AWS_S3_BUCKET_NAME = BUCKET;
    process.env.AWS_S3_BASE_URL = BASE;
    process.env.AWS_S3_BUCKET_REGION = 'sa-east-1';
    for (const k of ['R2_ACCESS_KEY_ID', 'R2_BUCKET', 'R2_PUBLIC_URL', 'R2_ENDPOINT']) delete process.env[k];
    const storage = new StorageService();
    jest.spyOn(storage, 'uploadDataUrl').mockResolvedValue(NOVO);
    return storage;
  }

  afterEach(() => {
    process.env = { ...ambienteOriginal };
    jest.restoreAllMocks();
  });

  const tenant: any = {
    assertCondominio: jest.fn(async () => undefined),
    assertEntidade: jest.fn(async () => undefined),
  };

  async function arquivoInvalido(p: Promise<unknown>) {
    const erro: any = await p.catch((e) => e);
    expect(erro).toBeInstanceOf(BadRequestException);
    expect(erro.message).toBe('Arquivo inválido.');
  }

  describe('DocumentosService.insert — link_doc', () => {
    function build() {
      const prisma: any = {
        isConnected: true,
        documentos: { create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })) },
      };
      const chatIa: any = { indexarDocumentoPorId: jest.fn(async () => ({ indexed: 0 })) };
      const storage = storageReal();
      return { service: new DocumentosService(prisma, storage, tenant, chatIa), prisma, storage, chatIa };
    }

    it('URL do bucket de outro registro: 400, nada gravado nem indexado', async () => {
      const { service, prisma, chatIa } = build();
      await arquivoInvalido(service.insert(1, { nome: 'Regimento', link_doc: ALHEIO }, sindico));
      expect(prisma.documentos.create).not.toHaveBeenCalled();
      expect(chatIa.indexarDocumentoPorId).not.toHaveBeenCalled();
    });

    it('URL do bucket assinada também é recusada (a chave é o que conta)', async () => {
      const { service, prisma, storage } = build();
      const assinada = await storage.assinarUrl(ALHEIO);
      await arquivoInvalido(service.insert(1, { nome: 'Regimento', link_doc: assinada }, sindico));
      expect(prisma.documentos.create).not.toHaveBeenCalled();
    });

    it('data URL em link_doc vira upload', async () => {
      const { service, prisma, storage } = build();
      await service.insert(1, { nome: 'Regimento', link_doc: DATA_URL }, sindico);
      expect(storage.uploadDataUrl).toHaveBeenCalledWith(DATA_URL, 'documentos');
      expect(prisma.documentos.create.mock.calls[0][0].data.link_doc).toBe(NOVO);
    });

    it('arquivo em `doc` continua virando upload', async () => {
      const { service, prisma } = build();
      await service.insert(1, { nome: 'ATA', doc: DATA_URL, is_ata: 1 }, sindico);
      expect(prisma.documentos.create.mock.calls[0][0].data.link_doc).toBe(NOVO);
    });

    it('vazio grava vazio', async () => {
      const { service, prisma } = build();
      await service.insert(1, { nome: 'Sem arquivo', link_doc: '' }, sindico);
      expect(prisma.documentos.create.mock.calls[0][0].data.link_doc).toBe('');
    });

    it('URL fora do bucket segue a regra atual (gravada como veio)', async () => {
      const { service, prisma } = build();
      await service.insert(1, { nome: 'Externo', link_doc: 'https://exemplo.com/regimento.pdf' }, sindico);
      expect(prisma.documentos.create.mock.calls[0][0].data.link_doc).toBe('https://exemplo.com/regimento.pdf');
    });
  });

  describe('AssembleiasService — anexos e ATA', () => {
    function build() {
      const prisma: any = {
        isConnected: true,
        users: { findUnique: jest.fn(async () => null) },
        assembleias: {
          create: jest.fn(async () => ({ id: 2 })),
          updateMany: jest.fn(async () => ({ count: 1 })),
          findUnique: jest.fn(async () => ({ id: 2, id_condominio: 1, anexos: ANEXO })),
          findFirst: jest.fn(async () => ({ id: 2, id_condominio: 1, anexos: ANEXO })),
          delete: jest.fn(async () => ({})),
        },
        documentos: { create: jest.fn(async () => ({ id: 9 })) },
      };
      return { service: new AssembleiasService(prisma, storageReal(), tenant), prisma };
    }

    it('criar com anexo que é URL do bucket: 400', async () => {
      const { service, prisma } = build();
      await arquivoInvalido(service.insert(1, { titulo: 'AGO', docs: [ALHEIO] }, 7, sindico));
      expect(prisma.assembleias.create).not.toHaveBeenCalled();
    });

    it('editar reenviando o anexo que a assembleia já tem: aceito', async () => {
      const { service, prisma } = build();
      await service.update(1, { id: 2, titulo: 'AGO', docs: [ANEXO, DATA_URL] }, 7, sindico);
      expect(prisma.assembleias.updateMany.mock.calls[0][0].data.anexos).toBe(`${ANEXO};${NOVO}`);
    });

    it('anexo "externo;URL do bucket" não contrabandeia a URL alheia pelo ";": 400', async () => {
      const { service, prisma } = build();
      await arquivoInvalido(service.insert(1, { titulo: 'AGO', docs: [`https://exemplo.com/x;${ALHEIO}`] }, 7, sindico));
      expect(prisma.assembleias.create).not.toHaveBeenCalled();
      await arquivoInvalido(service.update(1, { id: 2, titulo: 'AGO', docs: [`https://exemplo.com/x;${ALHEIO}`] }, 7, sindico));
      expect(prisma.assembleias.updateMany).not.toHaveBeenCalled();
    });

    it('anexos já contaminados por ";" no banco não tornam a URL alheia "gravada"', async () => {
      const { service, prisma } = build();
      prisma.assembleias.findFirst.mockResolvedValue({ id: 2, id_condominio: 1, anexos: `https://exemplo.com/x;${ALHEIO}` });
      await arquivoInvalido(service.update(1, { id: 2, titulo: 'AGO', docs: [ALHEIO] }, 7, sindico));
      await arquivoInvalido(service.finish(1, { id: 2, titulo: 'AGO', data: '01/01/2026', doc: ALHEIO }, sindico));
      expect(prisma.assembleias.updateMany).not.toHaveBeenCalled();
      expect(prisma.documentos.create).not.toHaveBeenCalled();
    });

    it('editar com anexo de outro registro: 400', async () => {
      const { service, prisma } = build();
      await arquivoInvalido(service.update(1, { id: 2, titulo: 'AGO', docs: [ALHEIO] }, 7, sindico));
      expect(prisma.assembleias.updateMany).not.toHaveBeenCalled();
    });

    it('finalizar com ATA que é URL do bucket alheia: 400, nada publicado', async () => {
      const { service, prisma } = build();
      await arquivoInvalido(service.finish(1, { id: 2, titulo: 'AGO', data: '01/01/2026', doc: ALHEIO }, sindico));
      expect(prisma.documentos.create).not.toHaveBeenCalled();
      expect(prisma.assembleias.delete).not.toHaveBeenCalled();
    });

    it('finalizar com um anexo da própria assembleia como ATA: aceito', async () => {
      const { service, prisma } = build();
      await service.finish(1, { id: 2, titulo: 'AGO', data: '01/01/2026', doc: ANEXO }, sindico);
      expect(prisma.documentos.create.mock.calls[0][0].data.link_doc).toBe(ANEXO);
    });
  });
});
