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

  describe('sendCredentials', () => {
    function buildEnvio() {
      const mail: any = { sendWelcomeMorador: jest.fn(async () => ({})) };
      const prisma: any = {
        isConnected: true,
        moradores: {
          findUnique: jest.fn(async () => ({
            id: 10, id_user: 40, id_condominio: 1, nome: 'V', email: 'atacante@x.com',
            user: { id: 40 },
          })),
          update: jest.fn(),
          count: jest.fn(async () => 0),
        },
        users: {
          findUnique: jest.fn(async () => ({ email: 'vitima@x.com', login: 'vitima@x.com' })),
          findFirst: jest.fn(),
          update: jest.fn(async () => ({})),
        },
        sindicos_Condominios: { count: jest.fn(async () => 0) },
        funcionarios: { count: jest.fn(async () => 0) },
        apartamentos_Users: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
        facial_Devices: { findMany: jest.fn(async () => []) },
      };
      const svc = new MoradoresService(
        prisma, mail, {} as any, {} as any, { registrar: jest.fn(async () => ({})) } as any, {} as any,
      );
      return { svc, prisma, mail };
    }

    it('e-mail do cadastro trocado pelo operador: login intacto e senha vai para o e-mail da conta', async () => {
      const { svc, prisma, mail } = buildEnvio();
      await svc.sendCredentials(10, operador);
      await new Promise((r) => setImmediate(r));

      const data = prisma.users.update.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('login');
      expect(data).not.toHaveProperty('email');
      expect(mail.sendWelcomeMorador).toHaveBeenCalledTimes(1);
      expect(mail.sendWelcomeMorador.mock.calls[0][0]).toBe('vitima@x.com');
    });

    it('conta sem e-mail utilizável: recusa e não altera a senha', async () => {
      const { svc, prisma, mail } = buildEnvio();
      prisma.users.findUnique.mockResolvedValue({ email: null, login: '12345678900' });
      await expect(svc.sendCredentials(10, operador)).rejects.toThrow(/não tem e-mail de acesso/);
      expect(prisma.users.update).not.toHaveBeenCalled();
      expect(mail.sendWelcomeMorador).not.toHaveBeenCalled();
    });
  });
});
