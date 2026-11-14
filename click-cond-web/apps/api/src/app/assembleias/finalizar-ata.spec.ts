import { BadRequestException } from '@nestjs/common';
import { AssembleiasService } from './assembleias.service';

/**
 * "Finalizar e Gerar ATA" pelo console chegava sem arquivo: a API gravava a
 * ATA com `link_doc = ''` e apagava a assembleia — o cascade levava as
 * pautas, as opções e os votos, e a apuração deixava de existir.
 *
 * Agora: sem o PDF da ATA, 400 e nada muda. Com ele, antes de apagar, a
 * apuração de cada pauta (pergunta, opções e votos) vira um arquivo de texto
 * publicado junto da ATA, em Documentos > Atas. Tudo numa transação: se algo
 * falha, a assembleia fica.
 */
describe('AssembleiasService.finish — ATA obrigatória e apuração preservada', () => {
  const sindico: any = { sub: 7, typeAccess: 'Sindico', user: { id: 7 } };
  const PDF = 'data:application/pdf;base64,JVBERi0xLjQK';
  const URL_PDF = 'https://bucket.s3.amazonaws.com/atas/1-ata.pdf';
  const URL_TXT = 'https://bucket.s3.amazonaws.com/atas/2-apuracao.txt';

  const pauta = {
    id: 10,
    id_condominio: 1,
    titulo: 'Aprovação das contas de 2025',
    descricao: '',
    data_inicio: new Date('2026-11-01T00:00:00Z'),
    data_termino: new Date('2026-11-05T00:00:00Z'),
    opcoes: [
      { id: 1, nome: 'Aprovar', votos: [{ id: 1, id_user: 5, id_apto: 100, created_at: new Date('2026-11-02T12:00:00Z') }] },
      { id: 2, nome: 'Rejeitar; com ressalva', votos: [{ id: 2, id_user: 6, id_apto: 101, created_at: new Date('2026-11-02T13:00:00Z') }] },
      { id: 3, nome: 'Abster', votos: [] },
    ],
  };

  function build(opts: { pautas?: any[]; uploads?: Array<string | null> } = {}) {
    const ordem: string[] = [];
    const prisma: any = {
      isConnected: true,
      assembleias: {
        findUnique: jest.fn(async () => ({ id_condominio: 1, titulo: 'AGO 2026', data: new Date('2026-11-10T00:00:00Z') })),
        findFirst: jest.fn(async () => ({ anexos: '' })),
        delete: jest.fn(async () => {
          ordem.push('delete');
          return {};
        }),
      },
      votacoes: { findMany: jest.fn(async () => opts.pautas ?? [pauta]) },
      apartamentos_Users: {
        findMany: jest.fn(async () => [
          { id_user: 5, id_apto: 100 },
          { id_user: 6, id_apto: 101 },
        ]),
      },
      documentos: {
        create: jest.fn(async ({ data }: any) => {
          ordem.push(`doc:${data.nome}`);
          return { id: 1, ...data };
        }),
      },
    };
    prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
    const uploads = [...(opts.uploads ?? [URL_PDF, URL_TXT])];
    const storage: any = {
      isDataUrl: (v: unknown) => typeof v === 'string' && v.startsWith('data:') && v.includes('base64,'),
      uploadDataUrl: jest.fn(async () => uploads.shift() ?? null),
      exigirArquivoDoRegistro: jest.fn(async () => undefined),
      chaveDoArquivo: jest.fn(() => null),
    };
    const tenant: any = {
      assertCondominio: jest.fn(async () => undefined),
      assertEntidade: jest.fn(async () => undefined),
    };
    const service = new AssembleiasService(prisma, storage, tenant);
    return { service, prisma, storage, ordem };
  }

  const assembleia = (doc?: unknown) => ({ id: 2, titulo: 'AGO 2026', data: '10/11/2026', doc });

  it.each([undefined, null, '', '   '])('sem o PDF da ATA (%j): 400 e a assembleia fica', async (doc) => {
    const { service, prisma } = build();
    await expect(service.finish(1, assembleia(doc), sindico)).rejects.toThrow(
      new BadRequestException('Anexe o PDF da ATA.'),
    );
    expect(prisma.documentos.create).not.toHaveBeenCalled();
    expect(prisma.assembleias.delete).not.toHaveBeenCalled();
  });

  it('arquivo que não é PDF: 400 e a assembleia fica', async () => {
    const { service, prisma } = build();
    await expect(service.finish(1, assembleia('data:image/png;base64,iVBORw0KGgo='), sindico)).rejects.toThrow(
      'Anexe o PDF da ATA.',
    );
    expect(prisma.assembleias.delete).not.toHaveBeenCalled();
  });

  it('com o PDF: grava a ATA com o arquivo e a apuração das pautas antes de apagar', async () => {
    const { service, prisma, storage, ordem } = build();
    const res: any = await service.finish(1, assembleia(PDF), sindico);

    expect(storage.uploadDataUrl).toHaveBeenNthCalledWith(1, PDF, 'atas');
    const [dataUrlTxt, pasta] = storage.uploadDataUrl.mock.calls[1];
    expect(pasta).toBe('atas');
    expect(dataUrlTxt).toMatch(/^data:text\/plain;base64,/);
    const texto = Buffer.from(dataUrlTxt.split('base64,')[1], 'base64').toString('utf8');
    expect(texto).toContain('AGO 2026');
    expect(texto).toContain('Aprovação das contas de 2025');
    expect(texto).toContain('Aprovar: 1 voto(s)');
    expect(texto).toContain('Rejeitar; com ressalva: 1 voto(s)');
    expect(texto).toContain('Abster: 0 voto(s)');
    expect(texto).toContain('Total: 2 voto(s)');

    const docs = prisma.documentos.create.mock.calls.map((c: any) => c[0].data);
    expect(docs).toEqual([
      expect.objectContaining({ is_ata: 1, nome: 'ATA AGO 2026 - 10/11/2026', link_doc: URL_PDF, id_condominio: 1 }),
      expect.objectContaining({ is_ata: 1, nome: 'Apuração das pautas - ATA AGO 2026 - 10/11/2026', link_doc: URL_TXT }),
    ]);
    expect(ordem[ordem.length - 1]).toBe('delete');
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(res.message).toContain('ATA');
  });

  it('upload do PDF falhou: erro e a assembleia fica', async () => {
    const { service, prisma } = build({ uploads: [null] });
    await expect(service.finish(1, assembleia(PDF), sindico)).rejects.toThrow(/PDF da ATA/);
    expect(prisma.documentos.create).not.toHaveBeenCalled();
    expect(prisma.assembleias.delete).not.toHaveBeenCalled();
  });

  it('storage devolveu a própria data URL (sem bucket): erro e a assembleia fica', async () => {
    const { service, prisma } = build({ uploads: [PDF] });
    await expect(service.finish(1, assembleia(PDF), sindico)).rejects.toThrow(/PDF da ATA/);
    expect(prisma.assembleias.delete).not.toHaveBeenCalled();
  });

  it('não conseguiu guardar a apuração: erro e a assembleia fica', async () => {
    const { service, prisma } = build({ uploads: [URL_PDF, null] });
    await expect(service.finish(1, assembleia(PDF), sindico)).rejects.toThrow(/apuração/);
    expect(prisma.documentos.create).not.toHaveBeenCalled();
    expect(prisma.assembleias.delete).not.toHaveBeenCalled();
  });

  it('assembleia sem pautas: só a ATA, sem arquivo de apuração', async () => {
    const { service, prisma, storage } = build({ pautas: [] });
    await service.finish(1, assembleia(PDF), sindico);
    expect(storage.uploadDataUrl).toHaveBeenCalledTimes(1);
    expect(prisma.documentos.create).toHaveBeenCalledTimes(1);
    expect(prisma.assembleias.delete).toHaveBeenCalled();
  });

  it('nome longo não estoura a coluna (VarChar 255)', async () => {
    const { service, prisma } = build();
    await service.finish(1, { ...assembleia(PDF), titulo: 'A'.repeat(300) }, sindico);
    for (const c of prisma.documentos.create.mock.calls) expect(c[0].data.nome.length).toBeLessThanOrEqual(255);
  });
});
