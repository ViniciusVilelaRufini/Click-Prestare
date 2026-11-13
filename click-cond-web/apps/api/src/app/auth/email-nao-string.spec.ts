import { MobileAuthService } from './mobile-auth.service';
import { MoradoresService } from '../moradores/moradores.service';
import type { JwtPayload } from './jwt-payload.interface';

/**
 * Corpo sem DTO (any/interface): um objeto no lugar do e-mail virava filtro do Prisma
 * ({ contains: 'a' }) na busca de conflito em Users/Funcionarios_Portaria — "já existe"
 * x outro erro respondia se algum login de QUALQUER condomínio casava com o filtro.
 */
const FILTROS: any[] = [{ contains: 'a' }, ['a@x.com'], 123];
const MSG = 'E-mail inválido.';
const sindico: JwtPayload = { sub: 9, nome: 'Síndico', typeAccess: 'Sindico', user: { id: 9 } };

function mobile() {
  const tx: any = { moradores: { update: jest.fn(async () => ({})) }, users: { update: jest.fn(async () => ({})) } };
  const zero = () => jest.fn(async () => 0);
  const prisma: any = {
    isConnected: true,
    moradores: {
      findUnique: jest.fn(async () => ({
        id: 10, id_user: 40, id_condominio: 1, email: 'v@x.com', nome: 'V', data_nascimento: null, extra2: null,
        user: { id: 40, email: 'v@x.com', login: 'v@x.com' },
      })),
      count: zero(),
    },
    users: {
      findFirst: jest.fn(async () => null),
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => ({ id: 99, ...data })),
      update: jest.fn(async () => ({})),
    },
    sindicos_Condominios: { count: zero() },
    funcionarios: { count: zero(), findFirst: jest.fn(async () => null), create: jest.fn(async () => ({})), update: jest.fn(async () => ({})) },
    apartamentos_Users: { count: zero() },
    funcionarios_Portaria: {
      findUnique: jest.fn(async () => ({ id: 50, login: 'p@x.com', email: 'p@x.com', id_condominio: 1, password: '$2b$04$h', nome: 'P', telefone: null, turno: null })),
      findFirst: jest.fn(async () => null),
      update: jest.fn(async ({ data }: any) => ({ id: 50, login: 'p@x.com', email: 'p@x.com', id_condominio: 1, password: '$2b$04$h', nome: 'P', ...data })),
    },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const tenant: any = {
    assertEntidade: jest.fn(async () => undefined),
    assertCondominio: jest.fn(async () => undefined),
    assertPermissaoFuncionario: jest.fn(async () => undefined),
  };
  const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
  const svc = new MobileAuthService(prisma, { sign: jest.fn() } as any, {} as any, storage, {} as any, tenant);
  return { svc, prisma };
}

function web() {
  const tx: any = {
    moradores: { update: jest.fn(async () => ({ id: 10 })) },
    users: { update: jest.fn(async () => ({})) },
    apartamentos_Users: { updateMany: jest.fn(), deleteMany: jest.fn(), create: jest.fn() },
  };
  const prisma: any = {
    isConnected: true,
    moradores: {
      findUnique: jest.fn(async () => ({
        id: 10, id_user: 40, id_condominio: 1, email: 'v@x.com', nome: 'V',
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
  return { svc, prisma };
}

describe('R1 — edição: e-mail que não é string é recusado antes de qualquer consulta', () => {
  it.each(FILTROS)('app saveMorador (edição) com e-mail %p → 400', async (filtro) => {
    const { svc, prisma } = mobile();
    await expect(svc.saveMorador({ morador: { id: 10, email: filtro } }, true, sindico)).rejects.toThrow(MSG);
    expect(prisma.moradores.findUnique).not.toHaveBeenCalled();
    expect(prisma.users.findFirst).not.toHaveBeenCalled();
  });

  it.each(FILTROS)('web MoradoresService.update com e-mail %p → 400', async (filtro) => {
    const { svc, prisma } = web();
    await expect(svc.update(10, { email: filtro } as any, sindico)).rejects.toThrow(MSG);
    expect(prisma.moradores.findUnique).not.toHaveBeenCalled();
    expect(prisma.users.findFirst).not.toHaveBeenCalled();
  });

  it.each(FILTROS)('app saveFuncionario (edição) com e-mail %p → 400', async (filtro) => {
    const { svc, prisma } = mobile();
    await expect(svc.saveFuncionario({ funcionario: { id: 50, email: filtro } }, true, sindico)).rejects.toThrow(MSG);
    expect(prisma.funcionarios_Portaria.findUnique).not.toHaveBeenCalled();
    expect(prisma.funcionarios_Portaria.findFirst).not.toHaveBeenCalled();
  });

  it('app saveFuncionario (cadastro) com login objeto → 400', async () => {
    const { svc, prisma } = mobile();
    await expect(
      svc.saveFuncionario({ id_condominio: 1, funcionario: { nome: 'P', login: { not: '' } } }, false, sindico),
    ).rejects.toThrow(MSG);
    expect(prisma.funcionarios_Portaria.findUnique).not.toHaveBeenCalled();
  });
});

describe('R1 — a busca de conflito usa a string normalizada', () => {
  it('app saveMorador: trim + minúsculas', async () => {
    const { svc, prisma } = mobile();
    await svc.saveMorador({ morador: { id: 10, email: '  Novo@X.com ' } }, true, sindico);
    expect(prisma.users.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ email: 'novo@x.com' }, { login: 'novo@x.com' }], NOT: { id: 40 } },
      }),
    );
  });

  it('web MoradoresService.update: trim + minúsculas', async () => {
    const { svc, prisma } = web();
    await svc.update(10, { email: ' Novo@X.com ' } as any, sindico);
    expect(prisma.users.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ email: 'novo@x.com' }, { login: 'novo@x.com' }], NOT: { id: 40 } },
      }),
    );
  });

  it('app saveFuncionario (edição): trim', async () => {
    const { svc, prisma } = mobile();
    await svc.saveFuncionario({ funcionario: { id: 50, email: ' novo@x.com ' } }, true, sindico);
    expect(prisma.funcionarios_Portaria.findFirst).toHaveBeenCalledWith({
      where: { login: 'novo@x.com', NOT: { id: 50 } },
      select: { id: true },
    });
    expect(prisma.funcionarios_Portaria.update.mock.calls[0][0].data).toMatchObject({ login: 'novo@x.com', email: 'novo@x.com' });
  });
});
