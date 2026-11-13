import { MobileAuthService } from './mobile-auth.service';

/**
 * `POST /users/delete-account` apagava `Funcionarios_Portaria` só pelo
 * login/e-mail do Users, em qualquer condomínio. O e-mail do Users não é
 * verificado (o /sindico/signup é público): quem criasse uma conta com o
 * e-mail do porteiro de outro prédio e pedisse a exclusão derrubava o acesso
 * desse porteiro ao console.
 *
 * `Funcionarios_Portaria` não tem `id_user`. O critério passa a ser: o login
 * da pessoa E só nos condomínios em que ela tem vínculo de equipe — linha em
 * `Funcionarios` (funcionário) ou em `Sindicos_Condominios` (síndico, que
 * costuma ter login de portaria com o mesmo e-mail).
 */
describe('MobileAuthService.deleteAccount — porteiros só dos vínculos da pessoa', () => {
  function montar(vinculos: { func?: number[]; sind?: number[] }) {
    const prisma: any = {
      isConnected: true,
      users: { findUnique: jest.fn(async () => ({ login: 'porteiro@demo.com', email: 'porteiro@demo.com' })) },
      funcionarios: {
        findMany: jest.fn(async () => (vinculos.func ?? []).map((id_condominio) => ({ id_condominio }))),
      },
      sindicos_Condominios: {
        findMany: jest.fn(async () => (vinculos.sind ?? []).map((id_condominio) => ({ id_condominio }))),
      },
      funcionarios_Portaria: { deleteMany: jest.fn(async () => ({ count: 1 })) },
      moradores: { findMany: jest.fn(async () => []) },
      financeiro: { updateMany: jest.fn(async () => ({ count: 0 })) },
      $executeRaw: jest.fn(async () => 1),
      $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
    };
    const svc = new MobileAuthService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    (svc as any).logger = { warn: jest.fn(), error: jest.fn(), log: jest.fn() };
    return { svc, prisma };
  }

  it('conta sem vínculo de equipe NÃO apaga porteiro nenhum (nem com o mesmo e-mail)', async () => {
    const { svc, prisma } = montar({});
    await expect(svc.deleteAccount(5)).resolves.toEqual({ success: true });
    expect(prisma.funcionarios_Portaria.deleteMany).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it('apaga só o login da pessoa nos condomínios em que ela é funcionária ou síndica', async () => {
    const { svc, prisma } = montar({ func: [3], sind: [4, 3] });
    await svc.deleteAccount(5);
    expect(prisma.funcionarios.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id_user: 5 } }),
    );
    expect(prisma.sindicos_Condominios.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id_user: 5 } }),
    );
    const where = prisma.funcionarios_Portaria.deleteMany.mock.calls[0][0].where;
    expect(where.login).toEqual({ in: ['porteiro@demo.com'] });
    expect(new Set(where.id_condominio.in)).toEqual(new Set([3, 4]));
  });
});
