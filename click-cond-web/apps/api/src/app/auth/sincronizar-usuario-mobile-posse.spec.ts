import { BadRequestException } from '@nestjs/common';
import { MobileAuthService } from './mobile-auth.service';
import { TenantAccessService } from './tenant-access.service';
import type { JwtPayload } from './jwt-payload.interface';

/**
 * saveFuncionario sincroniza o login de portaria com a conta do app (sincronizarUsuarioMobile). A conta era
 * achada só por `Users.login = Funcionarios_Portaria.login` e recebia um vínculo de equipe com todas as flags,
 * sem prova de que é daquele porteiro: um login de portaria antigo cujo texto coincide com o login de OUTRA
 * pessoa ligava a conta dela ao condomínio na primeira edição. E o patch regravava nome/telefone/e-mail/foto
 * da linha global Users mesmo quando a conta tem vínculo em outro condomínio.
 */
type Vinculo = { id_user: number; id_condominio: number };

function prismaFalso(opts: {
  conta?: any;
  sindicos?: Vinculo[];
  funcionarios?: Array<Vinculo & { id: number }>;
  moradores?: Vinculo[];
  portaria: any;
}) {
  const casa = (v: Vinculo, where: any) =>
    v.id_user === where.id_user &&
    (where.id_condominio === undefined ||
      (typeof where.id_condominio === 'object'
        ? v.id_condominio !== where.id_condominio.not
        : v.id_condominio === where.id_condominio));
  const contar = (lista: Vinculo[] = []) => jest.fn(async ({ where }: any) => lista.filter((v) => casa(v, where)).length);
  const conta = opts.conta;
  return {
    isConnected: true,
    users: {
      findFirst: jest.fn(async ({ where }: any) => {
        const login = where?.login ?? where?.OR?.[0]?.login;
        return conta && conta.login === login ? conta : null;
      }),
      create: jest.fn(async ({ data }: any) => ({ id: 999, ...data })),
      update: jest.fn(async () => ({})),
    },
    sindicos: { count: jest.fn(async () => 0) },
    sindicos_Condominios: {
      count: contar(opts.sindicos),
      findFirst: jest.fn(async ({ where }: any) => ((opts.sindicos ?? []).some((v) => casa(v, where)) ? { id: 1 } : null)),
    },
    funcionarios: {
      count: contar(opts.funcionarios),
      findFirst: jest.fn(async ({ where }: any) => (opts.funcionarios ?? []).find((f) => casa(f, where)) ?? null),
      create: jest.fn(async ({ data }: any) => ({ id: 500, ...data })),
      update: jest.fn(async () => ({})),
    },
    moradores: { count: contar(opts.moradores) },
    apartamentos_Users: { count: jest.fn(async () => 0) },
    funcionarios_Portaria: {
      findUnique: jest.fn(async ({ where }: any) => (where.id === opts.portaria.id ? opts.portaria : null)),
      findFirst: jest.fn(async () => null),
      update: jest.fn(async ({ data }: any) => ({ ...opts.portaria, ...data })),
    },
    prestadores_servico: { findFirst: jest.fn(async () => null) },
  } as any;
}

function servico(prisma: any) {
  const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
  return new MobileAuthService(prisma, { sign: jest.fn() } as any, {} as any, storage, {} as any, new TenantAccessService(prisma));
}

const sindico: JwtPayload = { sub: 20, nome: 'Síndico', typeAccess: 'Sindico', user: { id: 20 } };
const portaria = { id: 50, login: 'v@t', email: 'v@t', password: '$2b$04$hash', nome: 'P', telefone: null, turno: 'Diurno', id_condominio: 2 };

describe('saveFuncionario → sincronizarUsuarioMobile: posse da conta achada pelo login', () => {
  it('(a) conta de OUTRA pessoa sem vínculo de equipe aqui (e de outro condomínio) → 400, nada é vinculado nem gravado', async () => {
    const prisma = prismaFalso({
      conta: { id: 70, login: 'v@t', email: 'v@t', password: '$2b$04$dela' },
      sindicos: [{ id_user: 20, id_condominio: 2 }],
      moradores: [{ id_user: 70, id_condominio: 1 }],
      portaria,
    });
    const svc = servico(prisma);

    await expect(
      svc.saveFuncionario({ id_condominio: 2, funcionario: { id: 50, nome: 'Novo Nome' } }, true, sindico),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.funcionarios.create).not.toHaveBeenCalled();
    expect(prisma.users.update).not.toHaveBeenCalled();
    expect(prisma.funcionarios_Portaria.update).not.toHaveBeenCalled();
  });

  it('(a) conta sem vínculo nenhum (nada prova a posse) → 400 e nenhum vínculo de equipe é criado', async () => {
    const prisma = prismaFalso({
      conta: { id: 70, login: 'v@t', email: 'v@t', password: '$2b$04$dela' },
      sindicos: [{ id_user: 20, id_condominio: 2 }],
      portaria,
    });
    const svc = servico(prisma);

    await expect(
      svc.saveFuncionario({ id_condominio: 2, funcionario: { id: 50, telefone: '1' } }, true, sindico),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.funcionarios.create).not.toHaveBeenCalled();
  });

  it('(b) conta já da equipe daqui com vínculo em outro condomínio: Users global intacto, vínculo local atualizado', async () => {
    const prisma = prismaFalso({
      conta: { id: 70, login: 'v@t', email: 'v@t', password: '$2b$04$dela' },
      sindicos: [{ id_user: 20, id_condominio: 2 }],
      funcionarios: [{ id: 33, id_user: 70, id_condominio: 2 }],
      moradores: [{ id_user: 70, id_condominio: 1 }],
      portaria,
    });
    const svc = servico(prisma);

    await svc.saveFuncionario({ id_condominio: 2, funcionario: { id: 50, nome: 'Nome Novo', telefone: '9' } }, true, sindico);

    for (const [arg] of prisma.users.update.mock.calls) {
      expect(arg.data).not.toHaveProperty('name');
      expect(arg.data).not.toHaveProperty('phone');
      expect(arg.data).not.toHaveProperty('email');
      expect(arg.data).not.toHaveProperty('photo');
    }
    expect(prisma.funcionarios.update).toHaveBeenCalledWith({
      where: { id: 33 },
      data: expect.objectContaining({ nome: 'Nome Novo', telefone: '9', id_condominio: 2 }),
    });
  });

  it('controle: conta só deste condomínio continua sendo atualizada', async () => {
    const prisma = prismaFalso({
      conta: { id: 70, login: 'v@t', email: 'v@t', password: '$2b$04$dela' },
      sindicos: [{ id_user: 20, id_condominio: 2 }],
      funcionarios: [{ id: 33, id_user: 70, id_condominio: 2 }],
      portaria,
    });
    const svc = servico(prisma);

    await svc.saveFuncionario({ id_condominio: 2, funcionario: { id: 50, nome: 'Nome Novo', telefone: '9' } }, true, sindico);

    expect(prisma.users.update).toHaveBeenCalledWith({
      where: { id: 70 },
      data: expect.objectContaining({ name: 'Nome Novo', phone: '9', email: 'v@t', is_funcionario: 1 }),
    });
    expect(prisma.funcionarios.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 33 } }));
    expect(prisma.funcionarios.create).not.toHaveBeenCalled();
  });

  it('controle: login de portaria sem conta continua criando a conta e o vínculo de equipe', async () => {
    const prisma = prismaFalso({ sindicos: [{ id_user: 20, id_condominio: 2 }], portaria });
    const svc = servico(prisma);

    await svc.saveFuncionario({ id_condominio: 2, funcionario: { id: 50, nome: 'Nome Novo' } }, true, sindico);
    expect(prisma.users.create).toHaveBeenCalled();
    expect(prisma.funcionarios.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id_user: 999, id_condominio: 2 }) });
  });
});
