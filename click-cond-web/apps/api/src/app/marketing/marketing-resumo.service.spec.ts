import { MarketingResumoService } from './marketing-resumo.service';

function montar(ads: any[], leads: any[]) {
  const prisma: any = {
    crm_Anuncios_Diario: {
      findMany: jest.fn(async () => ads),
      aggregate: jest.fn(async ({ where }: any) => ({
        _max: { atualizado_em: ads.filter((a) => a.plataforma === where.plataforma).length ? new Date('2026-09-27T10:00:00Z') : null },
      })),
    },
    crm_Leads: { findMany: jest.fn(async () => leads) },
  };
  return new MarketingResumoService(prisma);
}

const de = new Date('2026-09-01T00:00:00Z');
const ate = new Date('2026-09-30T23:59:59Z');

describe('MarketingResumoService', () => {
  it('soma por canal e calcula custo por lead e por contrato', async () => {
    const svc = montar(
      [
        { plataforma: 'google', dia: new Date('2026-09-10'), impressoes: 100, cliques: 10, gasto: 40, conversoes: 2 },
        { plataforma: 'google', dia: new Date('2026-09-11'), impressoes: 100, cliques: 10, gasto: 60, conversoes: 1 },
        { plataforma: 'openai', dia: new Date('2026-09-10'), impressoes: 50, cliques: 0, gasto: 0, conversoes: 0 },
      ],
      [
        { origem: 'google', status: 'fechado', criado_em: new Date('2026-09-10T12:00:00Z') },
        { origem: 'google', status: 'novo', criado_em: new Date('2026-09-11T12:00:00Z') },
        { origem: 'organico', status: 'novo', criado_em: new Date('2026-09-11T13:00:00Z') },
      ],
    );
    const r = await svc.resumo(de, ate);
    expect(r.investimento).toBe(100);
    expect(r.leads).toBe(3);
    expect(r.custoPorLead).toBeCloseTo(33.33, 2);
    expect(r.fechados).toBe(1);
    expect(r.custoPorContrato).toBe(100);
    const g = r.canais.find((c) => c.canal === 'google')!;
    expect(g).toEqual(expect.objectContaining({ impressoes: 200, cliques: 20, gasto: 100, leads: 2, custoPorLead: 50, fechados: 1 }));
    expect(g.ctr).toBeCloseTo(0.1);
    const o = r.canais.find((c) => c.canal === 'openai')!;
    expect(o.custoPorLead).toBeNull();
    const org = r.canais.find((c) => c.canal === 'organico')!;
    expect(org.gasto).toBeNull();
    expect(r.diario.find((d) => d.dia === '2026-09-11')).toEqual({ dia: '2026-09-11', gasto: 60, leads: 2 });
    expect(r.frescor.google).toBe('2026-09-27T10:00:00.000Z');
  });

  it('sem leads nem gasto não divide por zero', async () => {
    const r = await montar([], []).resumo(de, ate);
    expect(r.custoPorLead).toBeNull();
    expect(r.custoPorContrato).toBeNull();
    expect(r.frescor).toEqual({ google: null, openai: null });
  });
});
