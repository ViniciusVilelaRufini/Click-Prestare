import { MobileAuthService } from './mobile-auth.service';

/**
 * Excluir morador pela superfície mobile (removeMorador) e excluir a conta
 * (POST /users/delete-account) deixavam ativos os passes de carteira do
 * morador: a validação já negava (morador_removido), mas o passe seguia
 * válido no celular. Como no remove do painel (MoradoresService.remove), os
 * dois revogam os passes em segundo plano, sem bloquear a exclusão.
 */
describe('Exclusão de morador e de conta — passe da carteira', () => {
  const sindico = { sub: 1, nome: 'Síndico', typeAccess: 'Sindico' } as any;
  /** Revogação que nunca termina: prova que a exclusão não espera por ela. */
  const nuncaTermina = () => new Promise<void>(() => undefined);

  function montar(prisma: any, opts: { comWallet?: boolean } = {}) {
    const facial: any = { unsyncMoradorExcluido: jest.fn(async () => true) };
    const tenant: any = { assertEntidade: jest.fn(async () => undefined) };
    const wallet: any = { revogarDoMorador: jest.fn(nuncaTermina) };
    const svc = new MobileAuthService(
      prisma, {} as any, {} as any, {} as any, facial, tenant, {} as any, {} as any, {} as any, {} as any,
      undefined, undefined, opts.comWallet === false ? undefined : wallet,
    );
    (svc as any).logger = { warn: jest.fn(), error: jest.fn(), log: jest.fn() };
    jest.spyOn(svc as any, 'exigirFlagFuncionario').mockResolvedValue(undefined);
    return { svc, wallet };
  }

  describe('removeMorador (app)', () => {
    function prismaRemove(opts: { deleteFalha?: boolean } = {}) {
      const ordem: string[] = [];
      const prisma: any = {
        isConnected: true,
        moradores: {
          findUnique: jest.fn(async () => ({ id: 11, id_user: null, id_condominio: 1, face_id: null, nome: 'Ana' })),
          delete: jest.fn(async () => {
            if (opts.deleteFalha) throw Object.assign(new Error('fk'), { code: 'P2003' });
            ordem.push('delete');
            return {};
          }),
        },
      };
      prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
      return { prisma, ordem };
    }

    it('revoga os passes do morador excluído, sem esperar a revogação', async () => {
      const { prisma, ordem } = prismaRemove();
      const { svc, wallet } = montar(prisma);
      wallet.revogarDoMorador.mockImplementation(() => {
        ordem.push('revogar');
        return nuncaTermina();
      });
      await expect(svc.removeMorador(11, sindico)).resolves.toBe(true);
      expect(wallet.revogarDoMorador).toHaveBeenCalledWith(11, 1);
      expect(ordem).toEqual(['delete', 'revogar']);
    });

    it('exclusão que falha não revoga', async () => {
      const { prisma } = prismaRemove({ deleteFalha: true });
      const { svc, wallet } = montar(prisma);
      await expect(svc.removeMorador(11, sindico)).rejects.toThrow();
      expect(wallet.revogarDoMorador).not.toHaveBeenCalled();
    });

    it('sem o módulo da carteira, exclui normalmente', async () => {
      const { prisma } = prismaRemove();
      const { svc } = montar(prisma, { comWallet: false });
      await expect(svc.removeMorador(11, sindico)).resolves.toBe(true);
    });
  });

  describe('deleteAccount', () => {
    function prismaConta(opts: { deleteFalha?: boolean } = {}) {
      const ordem: string[] = [];
      const linhas = [
        { id: 11, face_id: null, id_condominio: 1 },
        { id: 12, face_id: 'morador_12', id_condominio: 2 },
      ];
      const prisma: any = {
        isConnected: true,
        users: { findUnique: jest.fn(async () => ({ login: 'm@t', email: 'm@t' })) },
        funcionarios_Portaria: { deleteMany: jest.fn(async () => ({ count: 0 })) },
        funcionarios: { findMany: jest.fn(async () => []) },
        sindicos_Condominios: { findMany: jest.fn(async () => []) },
        moradores: {
          // Respeita o filtro de rosto: a linha sem rosto também tem passe.
          findMany: jest.fn(async ({ where }: any) =>
            linhas.filter((l) => where?.face_id?.not !== null || l.face_id != null),
          ),
        },
        financeiro: { updateMany: jest.fn(async () => ({ count: 0 })) },
        $executeRaw: jest.fn(async () => {
          if (opts.deleteFalha) throw new Error('banco fora');
          ordem.push('delete');
          return 1;
        }),
        $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
      };
      return { prisma, ordem };
    }

    it('revoga os passes de cada cadastro de morador da conta depois de apagar, sem esperar', async () => {
      const { prisma, ordem } = prismaConta();
      const { svc, wallet } = montar(prisma);
      wallet.revogarDoMorador.mockImplementation((id: number) => {
        ordem.push(`revogar:${id}`);
        return nuncaTermina();
      });
      await expect(svc.deleteAccount(5)).resolves.toEqual({ success: true });
      expect(wallet.revogarDoMorador).toHaveBeenCalledWith(11, 1);
      expect(wallet.revogarDoMorador).toHaveBeenCalledWith(12, 2);
      expect(ordem).toEqual(['delete', 'revogar:11', 'revogar:12']);
    });

    it('exclusão da conta que falha não revoga', async () => {
      const { prisma } = prismaConta({ deleteFalha: true });
      const { svc, wallet } = montar(prisma);
      await expect(svc.deleteAccount(5)).rejects.toThrow('banco fora');
      expect(wallet.revogarDoMorador).not.toHaveBeenCalled();
    });
  });
});
