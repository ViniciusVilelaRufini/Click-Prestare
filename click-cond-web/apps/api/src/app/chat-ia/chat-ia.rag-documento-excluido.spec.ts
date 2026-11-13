import { ChatIaService } from './chat-ia.service';

/**
 * Upload dispara a indexação em segundo plano: reindexDocumento apaga os trechos, baixa o PDF,
 * gera embeddings (segundos) e grava com createMany SEM reconferir o documento. Se o síndico
 * excluísse o documento nessa janela, os trechos voltavam com source_id de um documento que não
 * existe — sem FK, ninguém os apagava, e o assistente seguia respondendo com eles.
 */
describe('ChatIaService — índice RAG de documento excluído', () => {
  const DOC = { id: 5, nome: 'Ata QA', link_doc: 'https://exemplo.com/ata-qa.pdf', is_ata: 1 };

  function build(existe: boolean[]) {
    const prisma: any = {
      isConnected: true,
      documentos: {
        // 1ª leitura: indexarDocumentoPorId; as seguintes: re-checagens do reindexDocumento.
        findFirst: jest.fn(async () => (existe.length ? (existe.shift() ? DOC : null) : DOC)),
        findMany: jest.fn(async () => [{ ...DOC, link_doc: 'https://exemplo.com/planilha.xlsx' }]),
      },
      rag_Embeddings: {
        deleteMany: jest.fn(async () => ({ count: 0 })),
        createMany: jest.fn(async () => ({ count: 1 })),
      },
    };
    const ia: any = { embedBatch: jest.fn(async (t: string[]) => t.map(() => [0.1, 0.2])) };
    const tenant: any = { assertCondominio: jest.fn(async () => undefined) };
    const svc: any = new ChatIaService(prisma, tenant, ia);
    jest.spyOn(svc, 'extrairTextoPdf').mockResolvedValue('Assembleia aprovou a pintura da fachada.');
    return { svc, prisma };
  }

  it('documento excluído durante a indexação: não grava trechos', async () => {
    const { svc, prisma } = build([true, false]);
    const r = await svc.indexarDocumentoPorId(1, 5);
    expect(r).toEqual({ skipped: true, motivo: 'nao_encontrado' });
    expect(prisma.rag_Embeddings.createMany).not.toHaveBeenCalled();
  });

  it('documento excluído logo depois do createMany: os trechos gravados saem', async () => {
    const { svc, prisma } = build([true, true, false]);
    await svc.indexarDocumentoPorId(1, 5);
    expect(prisma.rag_Embeddings.createMany).toHaveBeenCalled();
    const apagou = prisma.rag_Embeddings.deleteMany.mock.calls.map((c: any[]) => c[0]);
    // 1ª: limpeza antes de reindexar; 2ª: a dos trechos que voltaram.
    expect(apagou).toEqual([
      { where: { id_condominio: 1, source_id: 5 } },
      { where: { id_condominio: 1, source_id: 5 } },
    ]);
  });

  it('documento que segue existindo: grava e não apaga depois', async () => {
    const { svc, prisma } = build([true, true, true]);
    const r = await svc.indexarDocumentoPorId(1, 5);
    expect(r.indexed).toBeGreaterThan(0);
    expect(prisma.rag_Embeddings.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('reindexCondominio remove trechos de documentos que não existem mais', async () => {
    const { svc, prisma } = build([]);
    await svc.reindexCondominio(1, { sub: 9, nome: 'Síndico QA', typeAccess: 'Sindico' });
    expect(prisma.rag_Embeddings.deleteMany).toHaveBeenCalledWith({
      where: { id_condominio: 1, source_type: { in: ['ata', 'documento'] }, source_id: { notIn: [5] } },
    });
  });

  it('reindexCondominio: documento enviado durante o laço não perde os trechos na varredura de órfãos', async () => {
    const { svc, prisma } = build([]);
    prisma.documentos.findMany
      .mockResolvedValueOnce([{ ...DOC, link_doc: 'https://exemplo.com/planilha.xlsx' }])
      .mockResolvedValueOnce([{ id: 5 }, { id: 6 }]);
    await svc.reindexCondominio(1, { sub: 9, nome: 'Síndico QA', typeAccess: 'Sindico' });
    expect(prisma.rag_Embeddings.deleteMany).toHaveBeenCalledWith({
      where: { id_condominio: 1, source_type: { in: ['ata', 'documento'] }, source_id: { notIn: [5, 6] } },
    });
  });
});
