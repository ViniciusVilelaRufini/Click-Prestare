import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MobileAuthService } from './mobile-auth.service';
import { TenantAccessService } from './tenant-access.service';
import type { JwtPayload } from './jwt-payload.interface';

/**
 * Duas rotas do app devolviam cadastro de gente com checagem só de condomínio
 * — e morador pertence ao condomínio.
 *
 *  - `/moradores/get-all`: o cadastro do prédio inteiro, com nome, CPF,
 *    e-mail, telefone, nascimento e unidade. A tela que consome (Moradores)
 *    só aparece para o síndico, mas a restrição vivia no app.
 *  - `/apartamentos/get-moradores`: aceitava QUALQUER id_apto do condomínio.
 *    Bastava enumerar os ids para listar quem mora em cada apartamento.
 */
describe('Cadastro de moradores — escopo por papel e por apartamento', () => {
  const MEU_APTO = 7;
  const morador: JwtPayload = { sub: 50, nome: 'Morador', typeAccess: 'Morador' };
  const sindico: JwtPayload = { sub: 51, nome: 'Síndico', typeAccess: 'Sindico' };
  const porteiro: JwtPayload = { sub: 52, nome: 'Porteiro', id_condominio: 1 };

  function build() {
    const prisma: any = {
      isConnected: true,
      moradores: { findMany: jest.fn(async () => []) },
      apartamentos: {
        findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, id_condominio: 1 })),
      },
      apartamentos_Users: {
        // Duas formas de consulta caem aqui: a do TenantAccessService, que
        // pergunta "este usuário pertence ao condomínio?" (filtra por
        // `apartamento.id_condominio`), e a do escopo por unidade, que
        // pergunta "este apartamento é dele?" (filtra por `id_apto`).
        findFirst: jest.fn(async ({ where }: any) => {
          if (where.id_user !== 50) return null;
          if (where.id_apto !== undefined) {
            return where.id_apto === MEU_APTO ? { id_apto: MEU_APTO } : null;
          }
          return { id_apto: MEU_APTO }; // pertence ao condomínio
        }),
        findMany: jest.fn(async () => []),
      },
      sindicos_Condominios: { findFirst: jest.fn(async () => ({ id: 1 })) },
      funcionarios: { findFirst: jest.fn(async () => ({ id: 1 })) },
    };
    const tenant = new TenantAccessService(prisma);
    const svc = new MobileAuthService(
      prisma, { sign: jest.fn() } as any, {} as any, {} as any, {} as any, tenant,
    );
    return { svc, prisma };
  }

  describe('getAllMoradores (/moradores/get-all)', () => {
    it('NEGA morador — é o cadastro do prédio, com CPF', async () => {
      const { svc, prisma } = build();
      await expect(svc.getAllMoradores(1, morador)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.moradores.findMany).not.toHaveBeenCalled();
    });

    it('PERMITE síndico', async () => {
      const { svc, prisma } = build();
      await svc.getAllMoradores(1, sindico);
      expect(prisma.moradores.findMany).toHaveBeenCalled();
    });

    it('PERMITE porteiro da portaria-web', async () => {
      const { svc, prisma } = build();
      await svc.getAllMoradores(1, porteiro);
      expect(prisma.moradores.findMany).toHaveBeenCalled();
    });
  });

  describe('getMoradoresApto (/apartamentos/get-moradores)', () => {
    it('NEGA morador listar quem mora no apartamento do vizinho', async () => {
      const { svc, prisma } = build();
      await expect(svc.getMoradoresApto(99, undefined, morador))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.apartamentos_Users.findMany).not.toHaveBeenCalled();
    });

    it('PERMITE morador ver o próprio apartamento', async () => {
      const { svc, prisma } = build();
      await svc.getMoradoresApto(MEU_APTO, undefined, morador);
      expect(prisma.apartamentos_Users.findMany).toHaveBeenCalled();
    });

    it('PERMITE porteiro ver qualquer apartamento do condomínio', async () => {
      const { svc, prisma } = build();
      await svc.getMoradoresApto(99, undefined, porteiro);
      expect(prisma.apartamentos_Users.findMany).toHaveBeenCalled();
    });
  });
});

/**
 * `removeFuncionario` apagava os vínculos de equipe da pessoa em TODOS os
 * condomínios, não só naquele de onde ela estava sendo tirada — e apagava a
 * conta mesmo que ela seguisse trabalhando em outro prédio. O `remove` de
 * moradores já fazia o recorte por condomínio; aqui faltava.
 */
describe('removeFuncionario — escopo por condomínio', () => {
  const sindico: JwtPayload = { sub: 9, nome: 'Síndico', typeAccess: 'Sindico' };

  function build(aindaEmOutroPredio: number) {
    const chamadas: any[] = [];
    const prisma: any = {
      isConnected: true,
      funcionarios_Portaria: {
        findUnique: jest.fn(async () => ({ id: 50, login: 'p@x.com', id_condominio: 2 })),
        delete: jest.fn(async () => ({})),
      },
      users: {
        findFirst: jest.fn(async () => ({ id: 77, is_sindico: false, is_morador: false })),
        delete: jest.fn((args: any) => {
          chamadas.push({ op: 'users.delete', args });
          return Promise.resolve({});
        }),
      },
      funcionarios: {
        deleteMany: jest.fn((args: any) => {
          chamadas.push({ op: 'funcionarios.deleteMany', args });
          return Promise.resolve({ count: 1 });
        }),
        count: jest.fn(async () => aindaEmOutroPredio),
      },
      sindicos_Condominios: { findFirst: jest.fn(async () => ({ id: 1 })) },
    };
    prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
    const tenant = new TenantAccessService(prisma);
    const svc = new MobileAuthService(
      prisma, { sign: jest.fn() } as any, {} as any, {} as any, {} as any, tenant,
    );
    return { svc, prisma, chamadas };
  }

  it('apaga o vínculo só do condomínio de onde saiu', async () => {
    const { svc, chamadas } = build(0);
    await svc.removeFuncionario(50, sindico);
    const del = chamadas.find((c) => c.op === 'funcionarios.deleteMany');
    expect(del.args.where).toEqual({ id_user: 77, id_condominio: 2 });
  });

  it('NÃO apaga a conta de quem segue na equipe de outro prédio', async () => {
    const { svc, prisma } = build(1);
    await svc.removeFuncionario(50, sindico);
    expect(prisma.users.delete).not.toHaveBeenCalled();
  });

  it('apaga a conta quando não sobrou vínculo em lugar nenhum', async () => {
    const { svc, prisma } = build(0);
    await svc.removeFuncionario(50, sindico);
    expect(prisma.users.delete).toHaveBeenCalled();
  });

  it('falha de banco não vira mais "não encontrado"', async () => {
    const { svc, prisma } = build(0);
    prisma.$transaction = jest.fn(async () => {
      throw Object.assign(new Error('fk'), { code: 'P2003' });
    });
    const erro = await svc.removeFuncionario(50, sindico).catch((e) => e);
    expect(erro).toBeInstanceOf(BadRequestException);
    expect(erro.message).toContain('P2003');
  });
});
