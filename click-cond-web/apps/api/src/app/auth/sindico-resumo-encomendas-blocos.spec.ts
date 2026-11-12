import { MobileAuthService } from './mobile-auth.service';

/**
 * Home do síndico: (1) o atalho de encomendas lia `packages`, que o resumo do
 * síndico nunca devolvia ("Nada aguardando" mesmo com encomenda parada);
 * (2) o card do condomínio mostrava a coluna num_blocos (config) em vez dos
 * blocos reais dos apartamentos ("1 bloco · 39 unidades" com 6 blocos).
 */
describe('resumo do síndico — encomendas', () => {
  function build(encomendasCount = 1) {
    const prisma: any = {
      isConnected: true,
      sindicos_Condominios: { findMany: jest.fn(async () => [{ id_condominio: 1 }, { id_condominio: 2 }]) },
      financeiro: { findMany: jest.fn(async () => []) },
      ocorrencias: { count: jest.fn(async () => 0) },
      encomendas: { count: jest.fn(async () => encomendasCount) },
    };
    const svc = new MobileAuthService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    return { svc, prisma };
  }

  it('devolve packages com as encomendas não retiradas dos condomínios do síndico', async () => {
    const { svc, prisma } = build(3);
    const r: any = await svc.getSummary(1, 'Sindico');
    expect(r.packages).toBe(3);
    expect(r.debts).toEqual({ count: 0, total: 0 });
    const where = prisma.encomendas.count.mock.calls[0][0].where;
    expect(where.id_condominio).toEqual({ in: [1, 2] });
    expect(where.status.notIn).toEqual(['Retirada', 'retirada', 'Retirado', 'retirado', 'Cancelado', 'recusado']);
  });

  it('sem condomínio ou com erro, packages vem 0', async () => {
    const { svc, prisma } = build();
    prisma.sindicos_Condominios.findMany.mockResolvedValueOnce([]);
    expect(await svc.getSummary(1, 'Sindico')).toMatchObject({ packages: 0, occurrences: 0 });
    prisma.encomendas.count.mockRejectedValueOnce(new Error('x'));
    expect(await svc.getSummary(1, 'Sindico')).toMatchObject({ packages: 0, occurrences: 0 });
  });
});

describe('listagem de condomínios — número de blocos real', () => {
  const grupos = [
    { id_condominio: 1, bloco: 'Bloco A' },
    { id_condominio: 1, bloco: 'Bloco a ' },
    { id_condominio: 1, bloco: 'Bloco B' },
    { id_condominio: 1, bloco: 'A' },
    { id_condominio: 1, bloco: 'bloco a' },
    { id_condominio: 1, bloco: '' },
    { id_condominio: 1, bloco: null },
    { id_condominio: 2, bloco: null },
  ];

  it('síndico: conta blocos distintos (trim + minúsculas, sem vazio) numa única consulta', async () => {
    const groupBy = jest.fn(async () => grupos);
    const cond = (id: number, nb: number | null) => ({
      id, nome: 'C' + id, ativo: 1, num_blocos: nb, num_aptos: 5, financeiro: [], _count: { apartamentos: 5 },
    });
    const prisma: any = {
      isConnected: true,
      sindicos_Condominios: { findMany: jest.fn(async () => [{ condominio: cond(1, 1) }, { condominio: cond(2, 4) }, { condominio: cond(3, null) }]) },
      apartamentos_Users: { findMany: jest.fn(async () => []) },
      apartamentos: { groupBy },
    };
    const svc = Object.create(MobileAuthService.prototype) as any;
    svc.prisma = prisma;
    const lista = await svc.listCondominiosSindico(9);
    expect(lista.map((c: any) => c.num_blocos)).toEqual([2, 4, 1]);
    expect(groupBy).toHaveBeenCalledTimes(1);
  });

  it('morador: mesma contagem real', async () => {
    const groupBy = jest.fn(async () => grupos);
    const apto = (id: number) => ({
      id, apto: '1', bloco: 'A',
      condominio: { id: 1, nome: 'C', ativo: 1, financeiro: [], num_blocos: 1, num_aptos: 9 },
    });
    const prisma: any = {
      isConnected: true,
      apartamentos_Users: { findMany: jest.fn(async () => [{ tipo: 'proprietario', vencimento: null, apartamento: apto(7) }]) },
      apartamentos: { groupBy },
    };
    const svc = Object.create(MobileAuthService.prototype) as any;
    svc.prisma = prisma;
    const [item] = await svc.listCondominiosMorador(9);
    expect(item.num_blocos).toBe(2);
  });
});
