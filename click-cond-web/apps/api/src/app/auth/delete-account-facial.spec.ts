import { MobileAuthService } from './mobile-auth.service';

/**
 * POST /users/delete-account (LGPD / Play Store) apagava Users em SQL cru e deixava a cascata levar
 * Moradores, o único lugar onde o face_id está. O rosto continuava nos terminais: só a varredura
 * horária de fantasmas tirava, e só de terminal ativo e listável.
 */
describe('MobileAuthService.deleteAccount — rosto nos terminais', () => {
  function montar(opts: { unsyncFalha?: boolean; deleteFalha?: boolean } = {}) {
    const ordem: string[] = [];
    const prisma: any = {
      isConnected: true,
      users: { findUnique: jest.fn(async () => ({ login: 'm@t', email: 'm@t' })) },
      funcionarios_Portaria: { deleteMany: jest.fn(async () => ({ count: 0 })) },
      funcionarios: { findMany: jest.fn(async () => []) },
      sindicos_Condominios: { findMany: jest.fn(async () => []) },
      moradores: {
        findMany: jest.fn(async () => [
          { id: 11, face_id: 'morador_11', id_condominio: 1 },
          { id: 12, face_id: 'morador_12', id_condominio: 2 },
        ]),
      },
      financeiro: { updateMany: jest.fn(async () => ({ count: 0 })) },
      $executeRaw: jest.fn(async () => {
        // FK RESTRICT (ex.: fk_vaga_benef antes de 2026-11-24-vagas-fk-set-null.sql) recusa o DELETE.
        if (opts.deleteFalha) throw Object.assign(new Error('Foreign key constraint failed'), { code: 'P2003' });
        ordem.push('delete');
        return 1;
      }),
      $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
    };
    const facial: any = {
      unsyncMoradorExcluido: jest.fn(async (id: number) => {
        ordem.push(`unsync:${id}`);
        if (opts.unsyncFalha) throw new Error('agente offline');
        return true;
      }),
    };
    const svc = new MobileAuthService(prisma, {} as any, {} as any, {} as any, facial, {} as any, {} as any, {} as any, {} as any, {} as any);
    (svc as any).logger = { warn: jest.fn(), error: jest.fn(), log: jest.fn() };
    return { svc, prisma, facial, ordem };
  }

  it('remove dos terminais o rosto de cada cadastro de morador da conta, depois de apagar o Users', async () => {
    const { svc, prisma, facial, ordem } = montar();

    await expect(svc.deleteAccount(5)).resolves.toEqual({ success: true });

    expect(prisma.moradores.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id_user: 5 }) }),
    );
    expect(facial.unsyncMoradorExcluido).toHaveBeenCalledWith(11, 'morador_11', 1);
    expect(facial.unsyncMoradorExcluido).toHaveBeenCalledWith(12, 'morador_12', 2);
    // As linhas são lidas antes do DELETE (a cascata as leva), o rosto sai depois dele.
    expect(ordem.indexOf('delete')).toBeGreaterThanOrEqual(0);
    expect(ordem.indexOf('unsync:11')).toBeGreaterThan(ordem.indexOf('delete'));
    expect(ordem.indexOf('unsync:12')).toBeGreaterThan(ordem.indexOf('delete'));
  });

  it('cadastro sem face_id também sai (terminal de área com reserva matricula sem face_id, F5)', async () => {
    const { svc, prisma, facial } = montar();
    prisma.moradores.findMany.mockResolvedValueOnce([{ id: 13, face_id: null, id_condominio: 1 }]);

    await expect(svc.deleteAccount(5)).resolves.toEqual({ success: true });

    expect(facial.unsyncMoradorExcluido).toHaveBeenCalledWith(13, null, 1);
  });

  it('DELETE recusado: a conta continua e o rosto NÃO sai dos terminais', async () => {
    const { svc, facial } = montar({ deleteFalha: true });

    await expect(svc.deleteAccount(5)).rejects.toThrow('Foreign key constraint failed');
    await new Promise((r) => setImmediate(r));

    expect(facial.unsyncMoradorExcluido).not.toHaveBeenCalled();
  });

  it('falha no terminal não impede a exclusão da conta', async () => {
    const { svc, prisma } = montar({ unsyncFalha: true });

    await expect(svc.deleteAccount(5)).resolves.toEqual({ success: true });
    await new Promise((r) => setImmediate(r)); // deixa o .catch do fire-and-forget rodar

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect((svc as any).logger.warn).toHaveBeenCalled();
  });
});
