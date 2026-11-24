import { ForbiddenException } from '@nestjs/common';
import { MobileAuthService } from './mobile-auth.service';
import { VagasMobileController, VeiculosMobileController } from './mobile-auth.controller';

/**
 * C1 — vagas e veículos do app mandavam só `id_condominio` e a API resolvia o
 * primeiro vínculo com `findFirst` sem unidade e sem `orderBy`: o dono do 101 e
 * do 202 abria o 202 e operava o 101 (vagas, visitante liberado, veículo e tag).
 *
 * Regra: `id_apartamento` (opcional) só escolhe entre os vínculos do próprio
 * usuário — unidade alheia dá 403; sem ele (app antigo), o vínculo mais antigo
 * (orderBy id asc), sempre o mesmo.
 *
 * O banco simulado devolve, sem `orderBy`, a ÚLTIMA linha que casa — como o
 * MySQL, que escolhe pelo plano de execução — e, com `orderBy: { id: 'asc' }`,
 * a primeira.
 */
describe('vagas/veículos do app — unidade aberta', () => {
  // Usuário 1 é dono do 101-A (apto 3, morador 10) e do 202-B (apto 4, morador 11).
  // O apto 9 (303-C) é de outro usuário. O apto 6 (404-D) não tem vínculo em
  // Apartamentos_Users, mas o usuário 1 tem registro de Moradores lá (morador 12).
  const APTOS: any[] = [
    { id: 3, id_condominio: 5, bloco: 'A', apto: '101', qtd_vagas: 1 },
    { id: 4, id_condominio: 5, bloco: 'B', apto: '202', qtd_vagas: 2 },
    { id: 6, id_condominio: 5, bloco: 'D', apto: '404', qtd_vagas: 1 },
    { id: 9, id_condominio: 5, bloco: 'C', apto: '303', qtd_vagas: 1 },
  ];
  const MORADORES: any[] = [
    { id: 10, id_user: 1, id_condominio: 5, bloco: 'A', apartamento: '101' },
    { id: 11, id_user: 1, id_condominio: 5, bloco: 'B', apartamento: '202' },
    { id: 12, id_user: 1, id_condominio: 5, bloco: 'D', apartamento: '404' },
    { id: 20, id_user: 2, id_condominio: 5, bloco: 'C', apartamento: '303' },
  ];
  const RELS: any[] = [
    { id: 100, id_user: 1, id_apto: 3 },
    { id: 101, id_user: 1, id_apto: 4 },
    { id: 102, id_user: 2, id_apto: 9 },
  ];

  // Casa só os campos simples; `condominio`/`apartamento` aninhados são
  // conferidos à parte (condomínio sempre ativo aqui).
  const casa = (row: any, where: any) =>
    Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
      if (k === 'condominio' || k === 'apartamento') return true;
      if (v === undefined) return true;
      return row[k] === v;
    });
  const escolhe = (rows: any[], args: any) => {
    if (!rows.length) return null;
    return args?.orderBy?.id === 'asc' ? [...rows].sort((a, b) => a.id - b.id)[0] : rows[rows.length - 1];
  };

  function build() {
    const prisma: any = {
      isConnected: true,
      moradores: {
        findFirst: jest.fn(async (args: any) => escolhe(MORADORES.filter((m) => casa(m, args.where)), args)),
      },
      apartamentos: {
        findFirst: jest.fn(async (args: any) => {
          const { condominio, ...w } = args.where;
          return escolhe(APTOS.filter((a) => casa(a, w)), args);
        }),
      },
      apartamentos_Users: {
        findFirst: jest.fn(async (args: any) => {
          const cond = args.where.apartamento?.id_condominio;
          const rows = RELS.filter((r) => casa(r, args.where))
            .map((r) => ({ ...r, apartamento: APTOS.find((a) => a.id === r.id_apto) }))
            .filter((r) => cond === undefined || r.apartamento.id_condominio === cond);
          return escolhe(rows, args);
        }),
      },
      veiculos: { findMany: jest.fn(async () => []) },
    };
    const svc = new MobileAuthService(prisma, {} as any, {} as any, {} as any, {} as any, { assertCondominio: jest.fn() } as any);
    return { svc: svc as any, prisma };
  }

  it('sem a unidade (app antigo): o vínculo mais antigo, sempre o mesmo', async () => {
    const { svc } = build();
    const ctx = await svc.resolveMoradorApto(1, 5);
    expect(ctx).toMatchObject({ moradorId: 10, idCondominio: 5, apto: { id: 3 } });
    expect(await svc.resolveMoradorId(1, 5)).toEqual({ id: 10, id_condominio: 5 });
  });

  it('com a unidade aberta: opera a unidade aberta, não a primeira', async () => {
    const { svc } = build();
    const ctx = await svc.resolveMoradorApto(1, 5, 4);
    expect(ctx).toMatchObject({ moradorId: 11, idCondominio: 5, apto: { id: 4, apto: '202' } });
  });

  it('unidade sem vínculo em Apartamentos_Users, mas com registro de Moradores: aceita', async () => {
    const { svc } = build();
    const ctx = await svc.resolveMoradorApto(1, 5, 6);
    expect(ctx).toMatchObject({ moradorId: 12, apto: { id: 6 } });
  });

  it('unidade que não é do usuário: 403', async () => {
    const { svc } = build();
    await expect(svc.resolveMoradorApto(1, 5, 9)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.resolveMoradorId(1, 5, 9)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('veículos listados são os do morador da unidade aberta', async () => {
    const { svc, prisma } = build();
    await svc.listVeiculosByUser(1, 5, 4);
    expect(prisma.veiculos.findMany.mock.calls[0][0].where).toMatchObject({ id_morador: 11 });
    await svc.listVeiculosByUser(1, 5);
    expect(prisma.veiculos.findMany.mock.calls[1][0].where).toMatchObject({ id_morador: 10 });
  });

  it('controllers repassam id_apartamento válido e ignoram vazio/-1', () => {
    const service: any = {
      listVeiculosByUser: jest.fn(),
      criarVeiculoMorador: jest.fn(),
      removerVeiculoMorador: jest.fn(),
      listVagasByUser: jest.fn(),
      liberarVaga: jest.fn(),
      revogarVaga: jest.fn(),
    };
    const payload: any = { sub: 1, user: { id: 1 } };
    const vei = new VeiculosMobileController(service);
    const vag = new VagasMobileController(service);
    vei.getAll(payload, '5', '4');
    expect(service.listVeiculosByUser).toHaveBeenLastCalledWith(1, 5, 4);
    vei.getAll(payload, '5', '');
    expect(service.listVeiculosByUser).toHaveBeenLastCalledWith(1, 5, undefined);
    vei.insert(payload, { id_condominio: '5', id_apartamento: '4', veiculo: {} });
    expect(service.criarVeiculoMorador).toHaveBeenLastCalledWith(1, 5, {}, 4);
    vei.remove(payload, { id: 7, id_condominio: 5, id_apartamento: -1 });
    expect(service.removerVeiculoMorador).toHaveBeenLastCalledWith(1, 5, 7, undefined);
    vag.getAll(payload, '5', '4');
    expect(service.listVagasByUser).toHaveBeenLastCalledWith(1, 5, 4);
    const corpo = { id_condominio: '5', id_apartamento: 4, tipo: 'visitante' };
    vag.liberar(payload, corpo);
    expect(service.liberarVaga).toHaveBeenLastCalledWith(1, 5, corpo, 4);
    vag.revogar(payload, { id: 8, id_condominio: 5 });
    expect(service.revogarVaga).toHaveBeenLastCalledWith(1, 5, 8, undefined);
  });
});
