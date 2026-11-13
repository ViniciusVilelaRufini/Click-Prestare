import { MobileAuthService } from './mobile-auth.service';

/**
 * removeFuncionario apagava o Users quando is_sindico/is_morador estavam em 0 — flags que o cadastro
 * de morador não marca ao ligar conta existente. A cascata levava o cadastro de morador da pessoa em
 * OUTRO condomínio. A decisão passa a ser pelos vínculos (contaSoDaEquipeDoCondominio).
 */
describe('removeFuncionario — a conta só é apagada sem nenhum outro vínculo', () => {
  const sindico = { sub: 9, nome: 'Síndico', typeAccess: 'Sindico' } as any;
  type V = { moradorFora?: number; unidades?: number; sindicoPerfil?: number; sindicoEm?: number; equipeFora?: number };

  function build(v: V) {
    const prisma: any = {
      isConnected: true,
      funcionarios_Portaria: {
        findUnique: jest.fn(async () => ({ id: 50, login: 'p@test', id_condominio: 1 })),
        delete: jest.fn(async () => ({})),
      },
      users: {
        findFirst: jest.fn(async () => ({ id: 7, is_sindico: 0, is_morador: 0 })),
        delete: jest.fn(async () => ({})),
      },
      funcionarios: { deleteMany: jest.fn(async () => ({ count: 1 })), count: jest.fn(async () => v.equipeFora ?? 0) },
      sindicos: { count: jest.fn(async () => v.sindicoPerfil ?? 0) },
      sindicos_Condominios: { count: jest.fn(async () => v.sindicoEm ?? 0) },
      moradores: { count: jest.fn(async () => v.moradorFora ?? 0) },
      apartamentos_Users: { count: jest.fn(async () => v.unidades ?? 0) },
    };
    prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
    const tenant: any = { assertEntidade: jest.fn(async () => undefined) };
    const svc = new MobileAuthService(prisma, {} as any, {} as any, {} as any, {} as any, tenant);
    return { svc, prisma };
  }

  it.each<[string, V]>([
    ['moradora de outro condomínio', { moradorFora: 1 }],
    ['ligada a uma unidade', { unidades: 1 }],
    ['com perfil de síndico', { sindicoPerfil: 1 }],
    ['síndica de um condomínio', { sindicoEm: 1 }],
    ['da equipe de outro prédio', { equipeFora: 1 }],
  ])('NÃO apaga a conta (flags em 0) quando ela é %s; tira só o vínculo de equipe', async (_n, v) => {
    const { svc, prisma } = build(v);
    await svc.removeFuncionario(50, sindico);
    expect(prisma.users.delete).not.toHaveBeenCalled();
    expect(prisma.funcionarios.deleteMany).toHaveBeenCalledWith({ where: { id_user: 7, id_condominio: 1 } });
    expect(prisma.funcionarios_Portaria.delete).toHaveBeenCalledWith({ where: { id: 50 } });
  });

  it('apaga a conta quando ela era só da equipe deste condomínio', async () => {
    const { svc, prisma } = build({});
    await svc.removeFuncionario(50, sindico);
    expect(prisma.users.delete).toHaveBeenCalledWith({ where: { id: 7 } });
  });
});
