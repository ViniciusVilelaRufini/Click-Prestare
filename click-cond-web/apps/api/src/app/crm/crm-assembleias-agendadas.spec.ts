import { CrmService } from './crm.service';

/**
 * Rodada 5 (revisão M-6): a assembleia finalizada não é mais apagada. O
 * cartão do cliente no CRM contava "assembleias agendadas" só pela data, e uma
 * assembleia finalizada antes do dia marcado continuava contando.
 */
describe('CrmService — assembleias agendadas não contam as finalizadas', () => {
  it('conta só data futura E não finalizada', async () => {
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
    const svc = new CrmService(prisma, {} as any, {} as any);

    await (svc as any).montarCliente({ id: 7, nome: 'Edifício Demo' });

    const [[arg]] = modelo('assembleias').count.mock.calls;
    expect(arg.where).toMatchObject({ id_condominio: 7, finalizada_em: null });
    expect(arg.where.data.gte).toBeInstanceOf(Date);
  });
});
