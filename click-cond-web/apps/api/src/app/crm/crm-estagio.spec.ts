import { CrmService } from './crm.service';

/**
 * Autocadastro nasce com ativo 0 e aprovado_em nulo: é "em análise" (estágio `pendente`), não churn.
 * Desativado no CRM (ativo 0 com aprovado_em preenchido) continua churn.
 */
function montarService() {
  const modelos = new Map<string, any>();
  const modelo = (nome: string) => {
    if (!modelos.has(nome)) {
      modelos.set(nome, {
        count: jest.fn(async () => 0),
        findMany: jest.fn(async () => []),
        findFirst: jest.fn(async () => null),
        findUnique: jest.fn(async () => null),
        groupBy: jest.fn(async () => []),
        aggregate: jest.fn(async () => ({ _count: 0, _sum: {}, _max: {} })),
      });
    }
    return modelos.get(nome);
  };
  const prisma: any = new Proxy({}, { get: (_t, nome: string) => (nome === 'then' ? undefined : modelo(nome)) });
  return new CrmService(prisma, {} as any, {} as any);
}

describe('CrmService — estágio pendente (autocadastro em análise)', () => {
  it('ativo 0 e aprovado_em nulo → pendente', async () => {
    const c = await (montarService() as any).montarCliente({ id: 1, nome: 'Novo', ativo: 0, aprovado_em: null });
    expect(c.estagio).toBe('pendente');
  });

  it('ativo 0 com aprovado_em → continua churn', async () => {
    const c = await (montarService() as any).montarCliente({ id: 2, nome: 'Velho', ativo: 0, aprovado_em: new Date('2026-01-01') });
    expect(c.estagio).toBe('churn');
  });

  it('visão geral: pendente fora do churn e da taxa, dentro de porEstagio.pendente', async () => {
    const svc = montarService() as any;
    const pend = await svc.montarCliente({ id: 1, nome: 'Novo', ativo: 0, aprovado_em: null });
    const churn = await svc.montarCliente({ id: 2, nome: 'Velho', ativo: 0, aprovado_em: new Date('2026-01-01') });
    const ov = svc.montarOverview([pend, churn]);
    expect(ov.churn).toBe(1);
    expect(ov.taxaChurn).toBe(100);
    expect(ov.porEstagio.pendente).toBe(1);
    expect(ov.porEstagio.churn).toBe(1);
  });

  it('visão geral: só pendente → churn 0 e taxa 0', async () => {
    const svc = montarService() as any;
    const pend = await svc.montarCliente({ id: 1, nome: 'Novo', ativo: 0, aprovado_em: null });
    const ov = svc.montarOverview([pend]);
    expect(ov.churn).toBe(0);
    expect(ov.taxaChurn).toBe(0);
  });
});
