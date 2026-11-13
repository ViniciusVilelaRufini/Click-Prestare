import * as bcrypt from 'bcrypt';
import { MobileAuthService } from './mobile-auth.service';
import type { JwtPayload } from './jwt-payload.interface';

/**
 * Users.login/email e Funcionarios_Portaria.login são ligados só por texto. Trocar o e-mail da conta para um
 * login de portaria (por exemplo o que ficava órfão quando o porteiro trocava o e-mail pelo app) fazia o
 * loginFuncionario tratar a conta como a do porteiro.
 */
describe('R12 — e-mail da conta × logins da portaria', () => {
  const SENHA = 'senhaAtual123';
  let hash: string;
  beforeAll(async () => {
    hash = await bcrypt.hash(SENHA, 4);
  });

  // Login de portaria sem conta Users com o mesmo texto.
  const portarias = [{ id: 70, login: 'porteiro@x.com', email: 'porteiro@x.com' }];

  function build() {
    const tx: any = {
      moradores: { update: jest.fn(async () => ({})) },
      users: { update: jest.fn(async () => ({})) },
      sindicos: { update: jest.fn(async () => ({})) },
      funcionarios: { update: jest.fn(async () => ({})) },
      funcionarios_Portaria: { updateMany: jest.fn(async () => ({ count: 1 })) },
      prestadores_servico: { updateMany: jest.fn(async () => ({ count: 1 })) },
    };
    const prisma: any = {
      isConnected: true,
      users: {
        findUnique: jest.fn(async () => ({
          id: 40, email: 'conta@x.com', login: 'conta@x.com', name: 'Titular', cpf: '111', phone: '999', photo: null, password: hash,
          sindicos: [{ id: 5, name: 'Titular', email: 'conta@x.com', phone: '999', doc_identification: '111', date_birth: null }],
          funcionarios: [{ id: 6 }],
        })),
        // Nenhuma outra conta Users usa os e-mails pedidos: o conflito, se houver, é só na portaria.
        findFirst: jest.fn(async () => null),
        update: jest.fn(async () => ({})),
      },
      moradores: {
        findUnique: jest.fn(async () => ({
          id: 10, id_user: 40, id_condominio: 1, email: 'conta@x.com', nome: 'Titular', data_nascimento: null, extra2: null,
          user: { id: 40, email: 'conta@x.com', login: 'conta@x.com' },
        })),
      },
      funcionarios: { findFirst: jest.fn(async () => ({ id: 6, id_user: 40, email: 'conta@x.com' })) },
      funcionarios_Portaria: {
        findFirst: jest.fn(async ({ where }: any) =>
          portarias.find((p) => (where.OR ?? []).some((c: any) => c.login === p.login || c.email === p.email)) ?? null,
        ),
      },
      prestadores_servico: { findFirst: jest.fn(async () => null) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const tenant: any = {
      assertEntidade: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async () => undefined),
    };
    const storage: any = { isDataUrl: jest.fn(() => false), uploadDataUrl: jest.fn() };
    const svc = new MobileAuthService(prisma, { sign: jest.fn(() => 'tok') } as any, {} as any, storage, {} as any, tenant);
    return { svc, prisma, tx };
  }

  const morador: JwtPayload = { sub: 40, nome: 'Titular', typeAccess: 'Morador', user: { id: 40 } };
  const funcionario: JwtPayload = { sub: 40, nome: 'Titular', typeAccess: 'Funcionario', user: { id: 40 } };

  it('updateSindico: trocar o e-mail para um login de portaria → 400 e Users intacto', async () => {
    const { svc, tx } = build();
    await expect(svc.updateSindico(40, { email: 'porteiro@x.com', senha_atual: SENHA })).rejects.toThrow(
      'Este e-mail já está sendo utilizado por outro usuário.',
    );
    expect(tx.users.update).not.toHaveBeenCalled();
  });

  it('updateInfosFuncionario: trocar o e-mail para um login de portaria → 400 e Users intacto', async () => {
    const { svc, tx } = build();
    await expect(
      svc.updateInfosFuncionario({ funcionario: { email: 'porteiro@x.com', senha_atual: SENHA } }, funcionario),
    ).rejects.toThrow('Já existe outro usuário com este e-mail.');
    expect(tx.users.update).not.toHaveBeenCalled();
  });

  it.each([['porteiro@x.com'], ['  Porteiro@X.com ']])(
    'saveMorador (autoedição): e-mail %p = login de portaria → 400 e Users intacto',
    async (email) => {
      const { svc, tx } = build();
      await expect(
        svc.saveMorador({ morador: { id: 10, nome: 'Titular', email, senha_atual: SENHA } }, true, morador),
      ).rejects.toThrow('Já existe outro usuário com este e-mail.');
      expect(tx.users.update).not.toHaveBeenCalled();
    },
  );

  it('updateInfosFuncionario: o login de portaria da conta muda junto com o login da conta', async () => {
    const { svc, tx } = build();
    await svc.updateInfosFuncionario({ funcionario: { email: 'novo@x.com', senha_atual: SENHA } }, funcionario);
    expect(tx.users.update.mock.calls[0][0].data).toMatchObject({ email: 'novo@x.com', login: 'novo@x.com' });
    expect(tx.funcionarios_Portaria.updateMany).toHaveBeenCalledWith({
      where: { login: { in: ['conta@x.com'] }, condominio: { funcionarios: { some: { id_user: 40 } } } },
      data: { login: 'novo@x.com', email: 'novo@x.com' },
    });
  });

  it('updateInfosFuncionario: o e-mail do prestador da conta muda junto (o login de portaria dele é achado por ele)', async () => {
    const { svc, tx } = build();
    await svc.updateInfosFuncionario({ funcionario: { email: 'novo@x.com', senha_atual: SENHA } }, funcionario);
    expect(tx.prestadores_servico.updateMany).toHaveBeenCalledWith({
      where: { email: { in: ['conta@x.com'] }, condominio: { funcionarios: { some: { id_user: 40 } } } },
      data: { email: 'novo@x.com' },
    });
  });

  it('updateInfosFuncionario: sem troca de e-mail o prestador não é tocado', async () => {
    const { svc, tx } = build();
    await svc.updateInfosFuncionario({ funcionario: { nome: 'Outro Nome' } }, funcionario);
    expect(tx.prestadores_servico.updateMany).not.toHaveBeenCalled();
  });

  it('updateSindico: trocar para um e-mail livre continua funcionando', async () => {
    const { svc, tx } = build();
    await svc.updateSindico(40, { email: 'livre@x.com', senha_atual: SENHA });
    expect(tx.users.update.mock.calls[0][0].data).toMatchObject({ email: 'livre@x.com', login: 'livre@x.com' });
  });
});
