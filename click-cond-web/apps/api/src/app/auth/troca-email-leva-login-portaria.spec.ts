import * as bcrypt from 'bcrypt';
import { MobileAuthService } from './mobile-auth.service';
import type { JwtPayload } from './jwt-payload.interface';

/**
 * Trocar o próprio e-mail/login pelo perfil de síndico (updateSindico) ou pela autoedição do morador
 * (saveMorador) mudava Users.login e deixava para trás o Funcionarios_Portaria.login da MESMA pessoa (síndico
 * com login de portaria próprio, morador que também é porteiro): nascia um login de portaria órfão, que outra
 * conta adotava ao trocar o e-mail para ele. Agora o login de portaria da conta vai junto, com o mesmo critério
 * do updateInfosFuncionario: login = login/e-mail antigo da conta, só nos condomínios em que ela é da equipe.
 */
describe('troca do próprio e-mail leva junto o login de portaria da conta', () => {
  const SENHA = 'senhaAtual123';
  let hash: string;
  beforeAll(async () => {
    hash = await bcrypt.hash(SENHA, 4);
  });

  function build(prestadoresDaEquipe: string[] = []) {
    const tx: any = {
      moradores: { update: jest.fn(async () => ({})) },
      users: { update: jest.fn(async () => ({})) },
      sindicos: { update: jest.fn(async () => ({})) },
      funcionarios_Portaria: { updateMany: jest.fn(async () => ({ count: 1 })) },
      prestadores_servico: { updateMany: jest.fn(async () => ({ count: 0 })) },
    };
    const prisma: any = {
      isConnected: true,
      users: {
        findUnique: jest.fn(async () => ({
          id: 40, email: 'conta@x.com', login: 'conta@x.com', name: 'Titular', cpf: '111', phone: '999', photo: null, password: hash,
          sindicos: [{ id: 5, name: 'Titular', email: 'conta@x.com', phone: '999', doc_identification: '111', date_birth: null }],
          moradores: [{ id: 10, nome: 'Titular' }],
        })),
        findFirst: jest.fn(async () => null),
        update: jest.fn(async () => ({})),
      },
      moradores: {
        findUnique: jest.fn(async () => ({
          id: 10, id_user: 40, id_condominio: 1, email: 'conta@x.com', nome: 'Titular', data_nascimento: null, extra2: null,
          user: { id: 40, email: 'conta@x.com', login: 'conta@x.com' },
        })),
        count: jest.fn(async () => 0),
      },
      funcionarios: { count: jest.fn(async () => 0) },
      sindicos_Condominios: { count: jest.fn(async () => 0) },
      apartamentos_Users: { count: jest.fn(async () => 0) },
      funcionarios_Portaria: { findFirst: jest.fn(async () => null) },
      prestadores_servico: {
        findFirst: jest.fn(async ({ where }: any) =>
          where?.condominio?.funcionarios?.some?.id_user === 40 && prestadoresDaEquipe.includes(where.email) ? { id: 3 } : null,
        ),
      },
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
  const sindicoOutro: JwtPayload = { sub: 98, nome: 'Síndico', typeAccess: 'Sindico', user: { id: 98 } };
  const levarJunto = {
    where: { login: { in: ['conta@x.com'] }, condominio: { funcionarios: { some: { id_user: 40 } } } },
    data: { login: 'novo@x.com', email: 'novo@x.com' },
  };

  it('updateSindico: o login de portaria da conta muda junto com o login da conta', async () => {
    const { svc, tx } = build();
    await svc.updateSindico(40, { email: 'Novo@X.com ', senha_atual: SENHA });
    expect(tx.users.update.mock.calls[0][0].data).toMatchObject({ email: 'novo@x.com', login: 'novo@x.com' });
    expect(tx.funcionarios_Portaria.updateMany).toHaveBeenCalledWith(levarJunto);
  });

  it('updateSindico: sem troca de e-mail o login de portaria não é tocado', async () => {
    const { svc, tx } = build();
    await svc.updateSindico(40, { nome: 'Outro Nome', email: 'conta@x.com' });
    expect(tx.funcionarios_Portaria.updateMany).not.toHaveBeenCalled();
  });

  it('updateSindico: e-mail novo igual ao de um prestador de onde a conta é equipe → 400 neutro e nada é gravado', async () => {
    const { svc, prisma, tx } = build(['prestador@x.com']);
    await expect(svc.updateSindico(40, { email: 'prestador@x.com', senha_atual: SENHA })).rejects.toThrow(
      'Este e-mail já está sendo utilizado por outro usuário.',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.funcionarios_Portaria.updateMany).not.toHaveBeenCalled();
  });

  it('saveMorador (autoedição): o login de portaria da conta muda junto com o login da conta', async () => {
    const { svc, tx } = build();
    await svc.saveMorador({ morador: { id: 10, nome: 'Titular', email: 'novo@x.com', senha_atual: SENHA } }, true, morador);
    expect(tx.users.update.mock.calls[0][0].data).toMatchObject({ email: 'novo@x.com', login: 'novo@x.com' });
    expect(tx.funcionarios_Portaria.updateMany).toHaveBeenCalledWith(levarJunto);
  });

  it('saveMorador (edição por terceiro): Users.login não muda, então o login de portaria também não', async () => {
    const { svc, tx } = build();
    await svc.saveMorador({ morador: { id: 10, nome: 'Titular', email: 'novo@x.com' } }, true, sindicoOutro);
    expect(tx.funcionarios_Portaria.updateMany).not.toHaveBeenCalled();
  });
});
