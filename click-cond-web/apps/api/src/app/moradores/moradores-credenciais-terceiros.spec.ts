import { MoradoresService } from './moradores.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Console: o operador edita o cadastro do morador (Moradores), mas não troca
 * e-mail/login/CPF da conta (Users) de outra pessoa, nem quando ela só mora
 * neste condomínio (era a brecha: a trava só olhava vínculo em outro prédio).
 */
describe('MoradoresService.update — credenciais da conta', () => {
  function build() {
    const tx: any = {
      moradores: { update: jest.fn(async () => ({ id: 10 })) },
      users: { update: jest.fn(async () => ({})) },
      apartamentos_Users: { updateMany: jest.fn(), deleteMany: jest.fn(), create: jest.fn() },
    };
    const prisma: any = {
      isConnected: true,
      moradores: {
        findUnique: jest.fn(async () => ({
          id: 10, id_user: 40, id_condominio: 1, email: 'vitima@x.com', nome: 'V',
          data_nascimento: new Date('1980-01-01'), extra2: null, user: { id: 40 },
        })),
        count: jest.fn(async () => 0),
      },
      users: { findFirst: jest.fn(async () => null) },
      sindicos_Condominios: { count: jest.fn(async () => 0) },
      funcionarios: { count: jest.fn(async () => 0) },
      apartamentos_Users: { count: jest.fn(async () => 0) },
      facial_Devices: { findMany: jest.fn(async () => []) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const svc = new MoradoresService(
      prisma, {} as any, { isDataUrl: jest.fn(() => false) } as any,
      { syncMorador: jest.fn(async () => ({})) } as any,
      { registrar: jest.fn(async () => ({})) } as any, {} as any,
    );
    return { svc, tx };
  }

  const operador: JwtPayload = { sub: 99, nome: 'Func', typeAccess: 'Funcionario', user: { id: 99 } };

  it('operador troca e-mail/CPF: Moradores muda, Users só recebe nome/telefone', async () => {
    const { svc, tx } = build();
    await svc.update(10, { email: 'atacante@x.com', documento: '999', nome: 'N', telefone: '1' } as any, operador);

    const dados = tx.moradores.update.mock.calls[0][0].data;
    expect(dados.email).toBe('atacante@x.com');
    expect(dados.documento).toBe('999');
    const patch = tx.users.update.mock.calls[0][0].data;
    expect(patch).not.toHaveProperty('email');
    expect(patch).not.toHaveProperty('login');
    expect(patch).not.toHaveProperty('cpf');
    expect(patch).toMatchObject({ name: 'N', phone: '1' });
  });
});
