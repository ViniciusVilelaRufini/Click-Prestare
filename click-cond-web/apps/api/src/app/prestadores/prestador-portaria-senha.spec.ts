import * as bcrypt from 'bcrypt';
import { PrestadoresService } from './prestadores.service';

/** dto.senha em branco virava '123456' no login de portaria e na conta do app do prestador. */
describe('PrestadoresService — acesso à portaria sem senha padrão', () => {
  // Conceder o login de portaria é do síndico (A5).
  const operador = { sub: 51, nome: 'Síndico', id_condominio: 1, typeAccess: 'Sindico' } as any;
  const prestador = { id: 1, id_condominio: 1, id_apartamento: null, email: 'p@test', nome: 'Eletricista', telefone: null, foto_pessoa: null, foto_documento: null };

  function build(loginExistente: any = null) {
    const prisma: any = {
      isConnected: true,
      prestadores_servico: {
        findUnique: jest.fn(async () => ({ ...prestador })),
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({ id: 2, ...data })),
        update: jest.fn(async ({ data }: any) => ({ ...prestador, ...data })),
      },
      funcionarios_Portaria: {
        findFirst: jest.fn(async () => loginExistente),
        create: jest.fn(async () => ({})),
        update: jest.fn(async () => ({})),
        deleteMany: jest.fn(async () => ({ count: 0 })),
      },
      users: { findFirst: jest.fn(async () => null), create: jest.fn(async ({ data }: any) => ({ id: 9, ...data })), update: jest.fn(async () => ({})) },
      funcionarios: { findFirst: jest.fn(async () => null), create: jest.fn(async () => ({})), update: jest.fn(async () => ({})) },
    };
    const tenant: any = {
      assertCondominio: jest.fn(async () => undefined),
      assertEntidade: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async () => undefined),
    };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn(), exigirArquivoDoRegistro: jest.fn(async () => undefined) };
    const facial: any = { syncPrestadorServico: jest.fn(async () => ({})) };
    return { svc: new PrestadoresService(prisma, storage, facial, tenant), prisma };
  }

  it.each([[undefined], [''], ['   ']])('create com acesso à portaria e senha %p → 400 antes de gravar', async (senha) => {
    const { svc, prisma } = build();
    await expect(
      svc.create({ id_condominio: 1, nome: 'Novo', email: 'novo@test', hasPortariaAccess: true, senha } as any, operador),
    ).rejects.toThrow('Informe uma senha para o acesso à portaria.');
    expect(prisma.prestadores_servico.create).not.toHaveBeenCalled();
    expect(prisma.funcionarios_Portaria.create).not.toHaveBeenCalled();
  });

  it('update que cria o login sem senha → 400 antes de gravar o prestador', async () => {
    const { svc, prisma } = build(null);
    await expect(svc.update(1, { hasPortariaAccess: true, senha: '' }, 1, operador)).rejects.toThrow(
      'Informe uma senha para o acesso à portaria.',
    );
    expect(prisma.prestadores_servico.update).not.toHaveBeenCalled();
    expect(prisma.funcionarios_Portaria.create).not.toHaveBeenCalled();
  });

  it('update com login já existente e sem senha mantém a senha; a conta do app nasce com o hash do login', async () => {
    const proprio = { id: 12, login: 'p@test', email: 'p@test', id_condominio: 1, turno: 'Geral', nome: 'Eletricista', telefone: null, password: '$2b$04$doLogin' };
    const { svc, prisma } = build(proprio);
    await svc.update(1, { hasPortariaAccess: true }, 1, operador);
    expect(prisma.funcionarios_Portaria.update.mock.calls[0][0].data).not.toHaveProperty('password');
    expect(prisma.users.create.mock.calls[0][0].data.password).toBe('$2b$04$doLogin');
  });

  it('update que cria o login com senha grava o hash dela, nunca 123456', async () => {
    const { svc, prisma } = build(null);
    await svc.update(1, { hasPortariaAccess: true, senha: 'Nova#123' }, 1, operador);
    const hash = prisma.funcionarios_Portaria.create.mock.calls[0][0].data.password;
    expect(await bcrypt.compare('Nova#123', hash)).toBe(true);
    expect(await bcrypt.compare('123456', hash)).toBe(false);
  });
});
