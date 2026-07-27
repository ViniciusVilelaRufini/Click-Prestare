import { DocumentosService } from './documentos.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Publicar documento tem que INDEXAR, e apagar tem que DESINDEXAR.
 *
 * A indexação só existia no endpoint manual de reindexação, que nenhuma tela
 * chamava: a ata subia e o assistente nunca via o conteúdo (o índice do
 * condomínio ficava vazio). Estes testes prendem o gatilho no lugar.
 */
describe('DocumentosService — indexação para o assistente', () => {
  const sindico: JwtPayload = {
    sub: 1,
    nome: 'Síndico',
    typeAccess: 'Sindico',
    id_condominio: 1,
  };

  function build() {
    const prisma: any = {
      isConnected: true,
      documentos: {
        create: jest.fn(async () => ({ id: 62 })),
        findUnique: jest.fn(async () => ({ id_condominio: 1 })),
        delete: jest.fn(async () => ({})),
      },
    };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const tenant: any = {
      assertCondominio: jest.fn(async () => undefined),
      assertEntidade: jest.fn(async () => undefined),
    };
    const chatIa: any = {
      indexarDocumentoPorId: jest.fn(async () => ({ indexed: 4 })),
      removerIndiceDocumento: jest.fn(async () => undefined),
    };
    const svc = new DocumentosService(prisma, storage, tenant, chatIa);
    return { svc, prisma, chatIa };
  }

  it('indexa o documento recém-publicado', async () => {
    const { svc, chatIa } = build();

    await svc.insert(
      1,
      { nome: 'Ata mes 07', link_doc: 'https://cdn/ata.pdf', is_ata: 1 },
      sindico,
    );

    // A indexação roda em segundo plano; espera o microtask esvaziar.
    await new Promise((r) => setImmediate(r));
    expect(chatIa.indexarDocumentoPorId).toHaveBeenCalledWith(1, 62);
  });

  // Baixar o PDF e gerar embeddings leva segundos — o síndico não pode ficar
  // esperando o upload "terminar" por causa disso.
  it('não espera a indexação para responder o upload', async () => {
    const { svc, chatIa } = build();
    let resolverIndexacao: (v: unknown) => void = () => undefined;
    chatIa.indexarDocumentoPorId.mockReturnValue(
      new Promise((r) => (resolverIndexacao = r)),
    );

    await expect(
      svc.insert(1, { nome: 'Ata', link_doc: 'https://cdn/a.pdf' }, sindico),
    ).resolves.toEqual({ success: true });

    resolverIndexacao({ indexed: 1 });
  });

  it('remove os trechos indexados ao apagar o documento', async () => {
    const { svc, chatIa } = build();

    await svc.remove(62, sindico);

    expect(chatIa.removerIndiceDocumento).toHaveBeenCalledWith(1, 62);
  });

  // Falha na indexação não pode derrubar a publicação: o documento continua
  // salvo e disponível para download.
  it('publica mesmo se a indexação falhar', async () => {
    const { svc, chatIa } = build();
    chatIa.indexarDocumentoPorId.mockRejectedValue(new Error('gemini fora'));

    await expect(
      svc.insert(1, { nome: 'Ata', link_doc: 'https://cdn/a.pdf' }, sindico),
    ).resolves.toEqual({ success: true });
    await new Promise((r) => setImmediate(r));
  });
});
