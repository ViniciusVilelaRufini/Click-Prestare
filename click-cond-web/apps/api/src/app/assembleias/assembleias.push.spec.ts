import { AssembleiasService } from './assembleias.service';
import { DocumentosService } from '../documentos/documentos.service';

/**
 * Rodada 4 — push aos moradores com o mesmo envio do "Novo comunicado"
 * (preferência `notif_comunicados`):
 *  - ao CONVOCAR assembleia (criação);
 *  - ao ABRIR enquete (criação; pauta de assembleia não, a convocação já avisa);
 *  - ao PUBLICAR ATA em Documentos, inclusive a gerada ao finalizar assembleia.
 * Edição não avisa. Falha de push nunca desfaz a gravação.
 */
const sindico: any = { sub: 7, typeAccess: 'Sindico', user: { id: 7 } };
const esvaziar = () => new Promise((r) => setImmediate(r));

const FILTRO_MORADORES = {
  where: { notif_comunicados: 1, fcm_token: { not: null }, moradores: { some: { id_condominio: 1 } } },
  select: { fcm_token: true },
};

function notificacoes(falha = false) {
  return {
    sendPushNotification: jest.fn(async () => {
      if (falha) throw new Error('FCM fora do ar');
      return 'ok';
    }),
  } as any;
}

function prismaBase(extra: Record<string, any> = {}) {
  const prisma: any = {
    isConnected: true,
    users: {
      findUnique: jest.fn(async () => ({ id: 7 })),
      findMany: jest.fn(async () => [{ fcm_token: 'tok-a' }, { fcm_token: 'tok-b' }]),
    },
    assembleias: {
      create: jest.fn(async ({ data }: any) => ({ id: 40, ...data })),
      updateMany: jest.fn(async () => ({ count: 1 })),
      findFirst: jest.fn(async () => ({ id: 5, anexos: '' })),
      findUnique: jest.fn(async () => ({ id_condominio: 1, titulo: 'AGO 2026', data: new Date('2026-11-20T00:00:00Z') })),
      delete: jest.fn(async () => ({})),
    },
    votacoes: {
      create: jest.fn(async () => ({ id: 9 })),
      findMany: jest.fn(async () => []),
    },
    votacoes_Opcoes: { createMany: jest.fn(async () => ({ count: 2 })) },
    apartamentos_Users: { findMany: jest.fn(async () => []) },
    documentos: { create: jest.fn(async ({ data }: any) => ({ id: 62, ...data })) },
    ...extra,
  };
  prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
  return prisma;
}

const storage: any = {
  isDataUrl: (v: unknown) => typeof v === 'string' && v.startsWith('data:') && v.includes('base64,'),
  uploadDataUrl: jest.fn(async () => 'https://bucket.s3.amazonaws.com/atas/1-ata.pdf'),
  exigirArquivoDoRegistro: jest.fn(async () => undefined),
  deleteUrl: jest.fn(async () => true),
  chaveDoArquivo: jest.fn(() => null),
};
const tenant: any = {
  assertCondominio: jest.fn(async () => undefined),
  assertEntidade: jest.fn(async () => undefined),
};

function assembleias(opts: { falha?: boolean; prisma?: any } = {}) {
  const prisma = opts.prisma ?? prismaBase();
  const push = notificacoes(opts.falha);
  const svc = new AssembleiasService(prisma, storage, tenant, push);
  return { svc, prisma, push };
}

describe('push ao convocar assembleia', () => {
  // Payload do app (new_assembleia.dart): data no toString() do DateTime do Dart.
  const doApp = { titulo: 'AGO 2026', data: '2026-11-20 00:00:00.000', hora: '19:30', local: 'Salão', descricao: '' };

  it('criação avisa os moradores com a preferência de avisos ligada', async () => {
    const { svc, prisma, push } = assembleias();
    await expect(svc.insert(1, { ...doApp }, 7, sindico)).resolves.toEqual({ success: true });
    await esvaziar();
    expect(prisma.users.findMany).toHaveBeenCalledWith(FILTRO_MORADORES);
    expect(push.sendPushNotification).toHaveBeenCalledTimes(2);
    expect(push.sendPushNotification).toHaveBeenCalledWith(
      'tok-a', 'Assembleia convocada', 'AGO 2026 — 20/11/2026 às 19:30', { type: 'assembleia', id: '40' },
    );
  });

  it('sem data e hora: só o título', async () => {
    const { svc, push } = assembleias();
    await svc.insert(1, { titulo: 'AGE' }, 7, sindico);
    await esvaziar();
    expect(push.sendPushNotification).toHaveBeenCalledWith('tok-a', 'Assembleia convocada', 'AGE', expect.any(Object));
  });

  it('edição não avisa', async () => {
    const { svc, push } = assembleias();
    await svc.update(1, { id: 5, ...doApp }, 7, sindico);
    await esvaziar();
    expect(push.sendPushNotification).not.toHaveBeenCalled();
  });

  it('falha no push não desfaz a convocação', async () => {
    const { svc, prisma } = assembleias({ falha: true });
    await expect(svc.insert(1, { ...doApp }, 7, sindico)).resolves.toEqual({ success: true });
    await esvaziar();
    expect(prisma.assembleias.create).toHaveBeenCalledTimes(1);
  });

  it('falha na consulta dos moradores também não', async () => {
    const prisma = prismaBase();
    prisma.users.findMany = jest.fn(async () => { throw new Error('banco'); });
    const { svc } = assembleias({ prisma });
    await expect(svc.insert(1, { ...doApp }, 7, sindico)).resolves.toEqual({ success: true });
    await esvaziar();
  });
});

describe('push ao abrir enquete', () => {
  // Payload do app (new_votacao.dart): datas no toString() do DateTime do Dart.
  const enquete = {
    titulo: 'Pintura da fachada', is_enquete: true, opcoes: ['Sim', 'Não'],
    data_inicio: '2026-11-14 00:00:00.000', data_termino: '2026-11-30 00:00:00.000',
  };

  it('enquete nova avisa os moradores', async () => {
    const { svc, push } = assembleias();
    await expect(svc.insertVotacao({ ...enquete }, 1, sindico)).resolves.toEqual({ success: true });
    await esvaziar();
    expect(push.sendPushNotification).toHaveBeenCalledTimes(2);
    expect(push.sendPushNotification).toHaveBeenCalledWith(
      'tok-a', 'Nova enquete', 'Pintura da fachada — vote até 30/11/2026', { type: 'enquete', id: '9' },
    );
  });

  it('pauta de assembleia não avisa (a convocação já avisou)', async () => {
    const { svc, push } = assembleias();
    await svc.insertVotacao({ ...enquete, is_enquete: false, id_assembleia: 5 }, 1, sindico);
    await esvaziar();
    expect(push.sendPushNotification).not.toHaveBeenCalled();
  });

  it('falha no push não desfaz a enquete', async () => {
    const { svc, prisma } = assembleias({ falha: true });
    await expect(svc.insertVotacao({ ...enquete }, 1, sindico)).resolves.toEqual({ success: true });
    await esvaziar();
    expect(prisma.votacoes_Opcoes.createMany).toHaveBeenCalledTimes(1);
  });
});

describe('push ao publicar ATA', () => {
  it('finalizar assembleia publica a ATA e avisa uma vez (a apuração não gera outro push)', async () => {
    const prisma = prismaBase({
      votacoes: {
        findMany: jest.fn(async () => [{
          id: 10, id_condominio: 1, titulo: 'Contas', descricao: '',
          data_inicio: new Date('2026-11-01T00:00:00Z'), data_termino: new Date('2026-11-05T00:00:00Z'),
          opcoes: [{ id: 1, nome: 'Aprovar', votos: [] }, { id: 2, nome: 'Rejeitar', votos: [] }],
        }]),
      },
    });
    storage.uploadDataUrl
      .mockResolvedValueOnce('https://bucket.s3.amazonaws.com/atas/1-ata.pdf')
      .mockResolvedValueOnce('https://bucket.s3.amazonaws.com/atas/2-apuracao.txt');
    const { svc, push } = assembleias({ prisma });
    await svc.finish(1, { id: 2, doc: 'data:application/pdf;base64,JVBERi0xLjQK' }, sindico);
    await esvaziar();
    expect(prisma.documentos.create).toHaveBeenCalledTimes(2);
    expect(push.sendPushNotification).toHaveBeenCalledTimes(2); // dois moradores, um aviso cada
    expect(push.sendPushNotification).toHaveBeenCalledWith(
      'tok-a', 'ATA publicada', 'ATA AGO 2026 - 20/11/2026', { type: 'ata', id: '62' },
    );
  });

  it('finalização que falha não avisa', async () => {
    const prisma = prismaBase();
    prisma.$transaction = jest.fn(async () => { throw new Error('banco'); });
    const { svc, push } = assembleias({ prisma });
    await expect(svc.finish(1, { id: 2, doc: 'data:application/pdf;base64,JVBERi0xLjQK' }, sindico)).rejects.toThrow();
    await esvaziar();
    expect(push.sendPushNotification).not.toHaveBeenCalled();
  });

  it('falha no push não desfaz a finalização', async () => {
    const { svc, prisma } = assembleias({ falha: true });
    await expect(
      svc.finish(1, { id: 2, doc: 'data:application/pdf;base64,JVBERi0xLjQK' }, sindico),
    ).resolves.toEqual(expect.objectContaining({ message: expect.any(String) }));
    await esvaziar();
    expect(prisma.assembleias.delete).toHaveBeenCalledTimes(1);
  });

  describe('Documentos', () => {
    function documentos(falha = false) {
      const prisma = prismaBase();
      const push = notificacoes(falha);
      const chatIa: any = { indexarDocumentoPorId: jest.fn(async () => ({ indexed: 1 })) };
      const st: any = { isDataUrl: () => false, uploadDataUrl: jest.fn(), exigirArquivoDoRegistro: jest.fn(async () => undefined) };
      const svc = new DocumentosService(prisma, st, tenant, chatIa, push);
      return { svc, prisma, push };
    }

    // Payload do app (new_document.dart) e do console: is_ata 1/true/'1'.
    it.each([1, true, '1'])('ATA nova (is_ata = %j) avisa os moradores', async (isAta) => {
      const { svc, push } = documentos();
      await svc.insert(1, { nome: 'ATA AGO 2026', link_doc: 'https://cdn/ata.pdf', is_ata: isAta }, sindico);
      await esvaziar();
      expect(push.sendPushNotification).toHaveBeenCalledWith(
        'tok-a', 'ATA publicada', 'ATA AGO 2026', { type: 'ata', id: '62' },
      );
    });

    it('documento que não é ATA não avisa', async () => {
      const { svc, push } = documentos();
      await svc.insert(1, { nome: 'Regimento', link_doc: 'https://cdn/r.pdf', is_ata: 0 }, sindico);
      await esvaziar();
      expect(push.sendPushNotification).not.toHaveBeenCalled();
    });

    it('falha no push não desfaz a publicação', async () => {
      const { svc, prisma } = documentos(true);
      await expect(
        svc.insert(1, { nome: 'ATA', link_doc: 'https://cdn/ata.pdf', is_ata: 1 }, sindico),
      ).resolves.toEqual({ success: true });
      await esvaziar();
      expect(prisma.documentos.create).toHaveBeenCalledTimes(1);
    });
  });
});
