import { MobileAuthService } from './mobile-auth.service';

/**
 * DELETE FROM Users + fk_fin_user ON DELETE CASCADE: o morador que excluía a conta apagava a taxa
 * condominial da unidade (paga ou em aberto). A cobrança do condomínio é desvinculada antes, na mesma
 * transação; só a conta pessoal (tipo 'D') segue a cascata.
 */
describe('deleteAccount — cobranças do condomínio sobrevivem à exclusão da conta', () => {
  function montar() {
    const ordem: string[] = [];
    const prisma: any = {
      isConnected: true,
      users: { findUnique: jest.fn(async () => ({ login: 'm@t', email: 'm@t' })) },
      funcionarios: { findMany: jest.fn(async () => []) },
      sindicos_Condominios: { findMany: jest.fn(async () => []) },
      funcionarios_Portaria: { deleteMany: jest.fn(async () => ({ count: 0 })) },
      moradores: { findMany: jest.fn(async () => []) },
      financeiro: {
        updateMany: jest.fn(() => {
          ordem.push('financeiro');
          return Promise.resolve({ count: 1 });
        }),
      },
      $executeRaw: jest.fn(() => {
        ordem.push('delete');
        return Promise.resolve(1);
      }),
      $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
    };
    const svc = new MobileAuthService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    (svc as any).logger = { warn: jest.fn(), error: jest.fn(), log: jest.fn() };
    return { svc, prisma, ordem };
  }

  it('desvincula tudo que não é conta pessoal (inclusive tipo NULL) antes do DELETE, numa transação', async () => {
    const { svc, prisma, ordem } = montar();
    await expect(svc.deleteAccount(5)).resolves.toEqual({ success: true });
    expect(prisma.financeiro.updateMany).toHaveBeenCalledWith({
      where: { id_usuario: 5, OR: [{ tipo: null }, { NOT: { tipo: 'D' } }] },
      data: { id_usuario: null },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(ordem).toEqual(['financeiro', 'delete']);
  });
});
