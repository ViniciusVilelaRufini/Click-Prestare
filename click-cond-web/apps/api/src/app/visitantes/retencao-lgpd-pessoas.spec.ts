import { VisitantesService } from './visitantes.service';

/**
 * C4 da auditoria (núcleo Pessoas+Visitas): com a flag ligada, toda foto de
 * rosto/documento nova nasce em `Pessoas`, mas `tickRetencaoDadosVisitantes`
 * só varria `Visitantes` — o expurgo LGPD de 90 dias (Art. 15/16) virava
 * no-op permanente para tudo que a migração cria.
 */
describe('VisitantesService.tickRetencaoDadosVisitantes — alcança Pessoas também', () => {
  function build() {
    const prisma: any = {
      isConnected: true,
      visitantes: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      pessoas: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const storage: any = { deleteUrl: jest.fn().mockResolvedValue(undefined) };
    const auditoria: any = { registrar: jest.fn().mockResolvedValue(undefined) };
    const svc = new VisitantesService(
      prisma,
      {} as any, // notifications
      storage,
      {} as any, // facial
      auditoria,
      {} as any, // tenant
      {} as any, // realtime
      {} as any, // visitasService
    );
    return { svc, prisma, storage, auditoria };
  }

  it('expurga fotos de Pessoas sem nenhuma visita aberta/agendada há mais de 90 dias', async () => {
    const { svc, prisma, storage, auditoria } = build();
    prisma.pessoas.findMany.mockResolvedValue([
      { id: 2000001, foto_pessoa: 'https://r2/rosto.jpg', foto_documento: 'https://r2/doc.jpg' },
    ]);
    prisma.pessoas.updateMany.mockResolvedValue({ count: 1 });

    const total = await svc.tickRetencaoDadosVisitantes(90);

    expect(prisma.pessoas.findMany).toHaveBeenCalledTimes(1);
    // Prova que o early-return do ramo Visitantes (legado, sem nada a
    // expurgar neste teste) não pulou o ramo Pessoas.
    expect(prisma.visitantes.updateMany).not.toHaveBeenCalled();
    expect(storage.deleteUrl).toHaveBeenCalledWith('https://r2/rosto.jpg');
    expect(storage.deleteUrl).toHaveBeenCalledWith('https://r2/doc.jpg');
    expect(prisma.pessoas.updateMany).toHaveBeenCalledWith({
      where: {
        id: 2000001,
        foto_pessoa: 'https://r2/rosto.jpg',
        foto_documento: 'https://r2/doc.jpg',
      },
      data: { foto_pessoa: null, foto_documento: null },
    });
    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ modulo: 'pessoas', acao: 'DELETE' }),
    );
    expect(total).toBe(1);
  });

  it('soma o total expurgado de Visitantes (legado) e de Pessoas (migrado) na mesma rodada', async () => {
    const { svc, prisma } = build();
    prisma.visitantes.findMany.mockResolvedValue([{ id: 5, foto_pessoa: null, foto_documento: null }]);
    prisma.visitantes.updateMany.mockResolvedValue({ count: 1 });
    prisma.pessoas.findMany.mockResolvedValue([{ id: 2000002, foto_pessoa: null, foto_documento: null }]);
    prisma.pessoas.updateMany.mockResolvedValue({ count: 1 });

    const total = await svc.tickRetencaoDadosVisitantes(90);

    expect(total).toBe(2);
  });

  it('não expurga quando não há Pessoa elegível (findMany vazio)', async () => {
    const { svc, prisma, storage } = build();

    const total = await svc.tickRetencaoDadosVisitantes(90);

    expect(storage.deleteUrl).not.toHaveBeenCalled();
    expect(prisma.pessoas.updateMany).not.toHaveBeenCalled();
    expect(total).toBe(0);
  });

  it('não apaga o arquivo quando a foto mudou durante a seleção', async () => {
    const { svc, prisma, storage } = build();
    prisma.pessoas.findMany.mockResolvedValue([
      { id: 2000003, foto_pessoa: 'https://r2/antiga.jpg', foto_documento: null },
    ]);
    prisma.pessoas.updateMany.mockResolvedValue({ count: 0 });

    const total = await svc.tickRetencaoDadosVisitantes(90);

    expect(total).toBe(0);
    expect(storage.deleteUrl).not.toHaveBeenCalled();
  });
});
