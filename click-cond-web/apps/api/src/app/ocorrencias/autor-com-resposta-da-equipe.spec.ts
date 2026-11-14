import { BadRequestException } from '@nestjs/common';
import { OcorrenciasService } from './ocorrencias.service';

/**
 * "Pendente" queria dizer "ninguém da equipe tocou", mas a equipe pode
 * responder (resposta pública) ou conversar no chat sem dar Ciente. O autor
 * então reescrevia o relato, trocava a categoria e EXCLUÍA a ocorrência, e a
 * exclusão levava em cascata a resposta e todas as mensagens da portaria.
 * Agora o autor só edita/exclui enquanto não há resposta pública e nenhuma
 * mensagem de outra pessoa — condição posta na própria escrita.
 */
describe('Ocorrências — autor não edita nem exclui depois que a equipe respondeu', () => {
  const autor = { sub: 100, typeAccess: 'Morador', user: { id: 100 } } as any;

  function montar(opts: { resposta_at?: Date | null; msgsDeOutros?: number } = {}) {
    const oc: any = { id: 5, id_condominio: 1, user: 100, status: 'Pendente', tipo: 1, resposta_at: opts.resposta_at ?? null };
    const prisma: any = {
      isConnected: true,
      ocorrencias: {
        findUnique: jest.fn(async () => ({ ...oc })),
        updateMany: jest.fn(async () => ({ count: 1 })),
        deleteMany: jest.fn(async () => ({ count: 1 })),
      },
      ocorrenciaMensagens: { count: jest.fn(async () => opts.msgsDeOutros ?? 0) },
      ocorrencias_Categorias: { findUnique: jest.fn(async () => ({ sla_horas: null })) },
      users: { findUnique: jest.fn(async () => null) },
    };
    const tenant: any = { assertEntidade: jest.fn(async () => undefined) };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const svc = new OcorrenciasService(prisma, { sendPushNotification: jest.fn() } as any, tenant, storage);
    return { svc, prisma };
  }

  const semEquipe = { resposta_at: null, mensagens: { none: { OR: [{ id_usuario: null }, { id_usuario: { not: 100 } }] } } };

  it('edição e exclusão do autor exigem, na escrita, sem resposta e sem mensagem de outra pessoa', async () => {
    const { svc, prisma } = montar();
    await svc.editarPeloAutor(5, { descricao: 'Novo relato' }, autor);
    expect(prisma.ocorrencias.updateMany.mock.calls[0][0].where).toEqual({ id: 5, user: 100, status: 'Pendente', ...semEquipe });
    await svc.removerPeloApp(5, autor);
    expect(prisma.ocorrencias.deleteMany.mock.calls[0][0].where).toEqual({ id: 5, user: 100, status: 'Pendente', ...semEquipe });
  });

  it('Pendente com resposta pública: autor não edita nem exclui', async () => {
    const { svc, prisma } = montar({ resposta_at: new Date() });
    const e1: any = await svc.editarPeloAutor(5, { descricao: 'x' }, autor).catch((x) => x);
    const e2: any = await svc.removerPeloApp(5, autor).catch((x) => x);
    for (const e of [e1, e2]) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect(e.message).toContain('já está em atendimento');
    }
    expect(prisma.ocorrencias.updateMany).not.toHaveBeenCalled();
    expect(prisma.ocorrencias.deleteMany).not.toHaveBeenCalled();
  });

  it('Pendente com mensagem da portaria no chat: autor não edita nem exclui', async () => {
    const { svc, prisma } = montar({ msgsDeOutros: 1 });
    expect(await svc.editarPeloAutor(5, { descricao: 'x' }, autor).catch((x) => x)).toBeInstanceOf(BadRequestException);
    expect(await svc.removerPeloApp(5, autor).catch((x) => x)).toBeInstanceOf(BadRequestException);
    const where = prisma.ocorrenciaMensagens.count.mock.calls[0][0].where;
    expect(where).toEqual({ id_ocorrencia: 5, OR: [{ id_usuario: null }, { id_usuario: { not: 100 } }] });
    expect(prisma.ocorrencias.updateMany).not.toHaveBeenCalled();
    expect(prisma.ocorrencias.deleteMany).not.toHaveBeenCalled();
  });
});
