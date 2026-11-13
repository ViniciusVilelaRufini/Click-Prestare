import { PrestadoresService } from './prestadores.service';

/** E-mail que não é texto (objeto/array no corpo) estourava em .trim() e saía como erro 500. */
describe('PrestadoresService — e-mail precisa ser texto', () => {
  const operador = { sub: 3, nome: 'Porteiro', id_condominio: 1 } as any;

  function build() {
    const prisma: any = {
      isConnected: true,
      prestadores_servico: {
        findUnique: jest.fn(async () => ({ id: 1, id_condominio: 1, id_apartamento: null, email: null, nome: 'Eletricista' })),
        findFirst: jest.fn(async () => null),
        create: jest.fn(),
        update: jest.fn(),
      },
      funcionarios_Portaria: { findFirst: jest.fn(async () => null) },
    };
    const tenant: any = {
      assertCondominio: jest.fn(async () => undefined),
      assertEntidade: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async () => undefined),
    };
    return { svc: new PrestadoresService(prisma, {} as any, {} as any, tenant), prisma };
  }

  it.each([[{ contains: '@' }], [['a@b.c']], [123]])('create com e-mail %p → 400 sem consultar nem gravar', async (email) => {
    const { svc, prisma } = build();
    for (const hasPortariaAccess of [false, true]) {
      await expect(
        svc.create({ id_condominio: 1, nome: 'Novo', email, hasPortariaAccess, senha: 'Senha#123' } as any, operador),
      ).rejects.toThrow('E-mail inválido.');
    }
    expect(prisma.prestadores_servico.findFirst).not.toHaveBeenCalled();
    expect(prisma.funcionarios_Portaria.findFirst).not.toHaveBeenCalled();
    expect(prisma.prestadores_servico.create).not.toHaveBeenCalled();
  });

  it.each([[{ contains: '@' }], [['a@b.c']], [123]])('update com e-mail %p → 400 sem consultar nem gravar', async (email) => {
    const { svc, prisma } = build();
    for (const hasPortariaAccess of [false, true]) {
      await expect(svc.update(1, { email, hasPortariaAccess } as any, 1, operador)).rejects.toThrow('E-mail inválido.');
    }
    expect(prisma.prestadores_servico.findUnique).not.toHaveBeenCalled();
    expect(prisma.funcionarios_Portaria.findFirst).not.toHaveBeenCalled();
    expect(prisma.prestadores_servico.update).not.toHaveBeenCalled();
  });
});
