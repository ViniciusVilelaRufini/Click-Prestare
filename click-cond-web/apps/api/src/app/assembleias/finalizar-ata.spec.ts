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

  function build(opts: { pautas?: any[]; uploads?: Array<string | null>; condAssembleia?: number } = {}) {
    const ordem: string[] = [];
    const condAssembleia = opts.condAssembleia ?? 1;
    const prisma: any = {
      isConnected: true,
      assembleias: {
        findUnique: jest.fn(async () => ({ id_condominio: condAssembleia, titulo: 'AGO 2026', data: new Date('2026-11-10T00:00:00Z') })),
        findFirst: jest.fn(async () => ({ anexos: '' })),
        delete: jest.fn(async () => {
          ordem.push('delete');
          return {};
        }),
      },
      // Filtra como o banco: só as pautas do condomínio pedido.
      votacoes: {
        findMany: jest.fn(async ({ where }: any) =>
          (opts.pautas ?? [{ ...pauta, id_condominio: condAssembleia }]).filter(
            (p) => where?.id_condominio === undefined || p.id_condominio === where.id_condominio,
          ),
        ),
      },
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
      // Como o real: só consulta os anexos gravados quando precisa (aqui, sempre).
      exigirArquivoDoRegistro: jest.fn(async (_v: unknown, gravados: unknown) => {
        if (typeof gravados === 'function') await gravados();
      }),
      deleteUrl: jest.fn(async () => true),
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
    expect(texto.charCodeAt(0)).toBe(0xfeff); // BOM: o navegador abre como UTF-8
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

  it('corpo com o condomínio A e assembleia do condomínio B: apuração e documentos vão para B', async () => {
    const { service, prisma, storage } = build({ condAssembleia: 2 });
    await service.finish(1, assembleia(PDF), sindico);
    expect(prisma.votacoes.findMany.mock.calls[0][0].where.id_condominio).toBe(2);
    expect(storage.uploadDataUrl).toHaveBeenCalledTimes(2); // PDF e apuração
    const docs = prisma.documentos.create.mock.calls.map((c: any) => c[0].data);
    expect(docs).toHaveLength(2);
    for (const d of docs) expect(d.id_condominio).toBe(2);
    expect(prisma.assembleias.findFirst).toHaveBeenCalled();
    for (const c of prisma.assembleias.findFirst.mock.calls) expect(c[0].where.id_condominio).toBe(2);
  });

  describe('arquivos órfãos no bucket', () => {
    it('apuração não subiu: apaga o PDF enviado nesta chamada', async () => {
      const { service, storage } = build({ uploads: [URL_PDF, null] });
      await expect(service.finish(1, assembleia(PDF), sindico)).rejects.toThrow(/apuração/);
      expect(storage.deleteUrl).toHaveBeenCalledWith(URL_PDF, ['atas/']);
      expect(storage.deleteUrl).toHaveBeenCalledTimes(1);
    });

    it('transação falhou: apaga o PDF e a apuração enviados, e repassa o erro', async () => {
      const { service, prisma, storage } = build();
      prisma.$transaction.mockRejectedValue(new Error('deadlock'));
      await expect(service.finish(1, assembleia(PDF), sindico)).rejects.toThrow('deadlock');
      expect(storage.deleteUrl).toHaveBeenCalledWith(URL_PDF, ['atas/']);
      expect(storage.deleteUrl).toHaveBeenCalledWith(URL_TXT, ['atas/']);
    });

    it('ATA que já era anexo da assembleia: nunca é apagada, só a apuração nova', async () => {
      const ANEXO = 'https://bucket.s3.amazonaws.com/assembleias/1-edital.pdf';
      const { service, prisma, storage } = build({ uploads: [URL_TXT] });
      prisma.$transaction.mockRejectedValue(new Error('falhou'));
      await expect(service.finish(1, assembleia(ANEXO), sindico)).rejects.toThrow('falhou');
      expect(storage.deleteUrl).toHaveBeenCalledWith(URL_TXT, ['atas/']);
      expect(storage.deleteUrl).not.toHaveBeenCalledWith(ANEXO, expect.anything());
    });

    it('sucesso: não apaga nada', async () => {
      const { service, storage } = build();
      await service.finish(1, assembleia(PDF), sindico);
      expect(storage.deleteUrl).not.toHaveBeenCalled();
    });
  });

  it('nome longo não estoura a coluna (VarChar 255)', async () => {
    const { service, prisma } = build();
    prisma.assembleias.findUnique.mockResolvedValue({
      id_condominio: 1, titulo: 'A'.repeat(300), data: new Date('2026-11-10T00:00:00Z'),
    });
    await service.finish(1, assembleia(PDF), sindico);
    for (const c of prisma.documentos.create.mock.calls) expect(c[0].data.nome.length).toBeLessThanOrEqual(255);
  });

  it('título e data da ATA vêm do banco, não do corpo', async () => {
    const { service, prisma, storage } = build();
    await service.finish(1, { id: 2, titulo: 'Qualquer coisa', data: '01/01/1999', doc: PDF }, sindico);
    const docs = prisma.documentos.create.mock.calls.map((c: any) => c[0].data.nome);
    expect(docs).toEqual(['ATA AGO 2026 - 10/11/2026', 'Apuração das pautas - ATA AGO 2026 - 10/11/2026']);
    const texto = Buffer.from(storage.uploadDataUrl.mock.calls[1][0].split('base64,')[1], 'base64').toString('utf8');
    expect(texto).toContain('AGO 2026 (10/11/2026)');
    expect(texto).not.toContain('Qualquer coisa');
  });

  it('assembleia sem data no banco: nome sem o " - " solto', async () => {
    const { service, prisma } = build({ pautas: [] });
    prisma.assembleias.findUnique.mockResolvedValue({ id_condominio: 1, titulo: 'AGE', data: null });
    await service.finish(1, assembleia(PDF), sindico);
    expect(prisma.documentos.create.mock.calls[0][0].data.nome).toBe('ATA AGE');
  });

  it.each([
    'https://bucket.s3.amazonaws.com/assembleias/1-foto.png',
    'https://bucket.s3.amazonaws.com/assembleias/1-planilha.xlsx?X-Amz-Signature=abc',
  ])('anexo que não é PDF (%s) como ATA: 400 e a assembleia fica', async (url) => {
    const { service, prisma } = build();
    await expect(service.finish(1, assembleia(url), sindico)).rejects.toThrow('Anexe o PDF da ATA.');
    expect(prisma.assembleias.delete).not.toHaveBeenCalled();
  });

  it('anexo PDF com URL assinada (query) é aceito como ATA', async () => {
    const { service, prisma } = build({ pautas: [] });
    const url = 'https://bucket.s3.amazonaws.com/assembleias/1-edital.PDF?X-Amz-Signature=abc';
    await service.finish(1, assembleia(url), sindico);
    expect(prisma.documentos.create.mock.calls[0][0].data.link_doc).toBe(url);
  });
});
