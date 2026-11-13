import * as bcrypt from 'bcrypt';
import { MobileAuthService } from './mobile-auth.service';
import { TenantAccessService } from './tenant-access.service';

/** Senha em branco virava os dígitos do CPF ou '123456' num login de portaria ativo e sem MFA. */
describe('saveFuncionario — sem senha padrão', () => {
  const atual = { id: 50, login: 'p@test', email: 'p@test', password: '$2b$04$antigo', nome: 'P', telefone: null, turno: null, id_condominio: 1 };
  function build() {
    const prisma: any = {
      isConnected: true,
      sindicos_Condominios: { findFirst: jest.fn(async () => ({ id: 1 })) },
      funcionarios_Portaria: {
        findUnique: jest.fn(async ({ where }: any) => (where.id === 50 ? { ...atual } : null)),
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({ id: 70, ...data })),
        update: jest.fn(async ({ data }: any) => ({ ...atual, ...data })),
      },
      users: { findFirst: jest.fn(async () => null), create: jest.fn(async ({ data }: any) => ({ id: 99, ...data })), update: jest.fn(async () => ({})) },
      funcionarios: { findFirst: jest.fn(async () => null), create: jest.fn(async () => ({})), update: jest.fn(async () => ({})) },
    };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const svc = new MobileAuthService(prisma, { sign: jest.fn() } as any, {} as any, storage, {} as any, new TenantAccessService(prisma));
    return { svc, prisma };
  }
  const sindico = { sub: 9, nome: 'S', typeAccess: 'Sindico' } as any;

  it.each([[{}], [{ senha: '' }], [{ senha: '   ' }], [{ documento: '123.456.789-00' }]])(
    'cadastro sem senha (%p) → 400 e nada é criado',
    async (extra) => {
      const { svc, prisma } = build();
      await expect(
        svc.saveFuncionario({ id_condominio: 1, funcionario: { nome: 'P', email: 'novo@test', ...extra } }, false, sindico),
      ).rejects.toThrow('Informe uma senha para o funcionário.');
      expect(prisma.funcionarios_Portaria.create).not.toHaveBeenCalled();
      expect(prisma.users.create).not.toHaveBeenCalled();
    },
  );

  it('cadastro com senha grava o hash da senha digitada', async () => {
    const { svc, prisma } = build();
    await svc.saveFuncionario({ id_condominio: 1, funcionario: { nome: 'P', email: 'novo@test', senha: 'Escolhida#1' } }, false, sindico);
    const hash = prisma.funcionarios_Portaria.create.mock.calls[0][0].data.password;
    expect(await bcrypt.compare('Escolhida#1', hash)).toBe(true);
    expect(await bcrypt.compare('123456', hash)).toBe(false);
  });

  it('cadastro grava login e e-mail sem espaços, como a edição', async () => {
    const { svc, prisma } = build();
    await svc.saveFuncionario({ id_condominio: 1, funcionario: { nome: 'P', email: '  novo@test  ', senha: 'Escolhida#1' } }, false, sindico);
    const data = prisma.funcionarios_Portaria.create.mock.calls[0][0].data;
    expect(data.login).toBe('novo@test');
    expect(data.email).toBe('novo@test');
  });

  it('edição sem senha mantém a senha atual do login de portaria', async () => {
    const { svc, prisma } = build();
    await svc.saveFuncionario({ id_condominio: 1, funcionario: { id: 50, nome: 'Novo Nome' } }, true, sindico);
    expect(prisma.funcionarios_Portaria.update.mock.calls[0][0].data).not.toHaveProperty('password');
  });

  // Só espaços é "sem senha": antes era truthy e a conta do app nascia com o hash de '   '.
  it.each([[{ senha: '   ' }], [{ password: ' \t ' }]])('edição com senha em branco (%p) = edição sem senha', async (extra) => {
    const { svc, prisma } = build();
    await svc.saveFuncionario({ id_condominio: 1, funcionario: { id: 50, nome: 'Novo Nome', ...extra } }, true, sindico);
    expect(prisma.funcionarios_Portaria.update.mock.calls[0][0].data).not.toHaveProperty('password');
    // Conta do app criada na sincronização reaproveita o hash que o login de portaria já tem.
    expect(prisma.users.create.mock.calls[0][0].data.password).toBe('$2b$04$antigo');
  });
});
