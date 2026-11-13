import { VisitantesService } from './visitantes.service';

/**
 * O prazo LGPD de 90 dias contava só a partir de `data_saida`: visita que ninguém encerrou (visitante
 * não veio, saiu sem registro, passagem nova criada pelo "liberar") e Pessoa sem nenhuma visita
 * (cancelada) guardavam rosto e documento para sempre.
 */
describe('Expurgo LGPD — fim da visita sem data_saida e Pessoa sem visita', () => {
  const DIA = 24 * 60 * 60 * 1000;
  const ha = (d: number) => new Date(Date.now() - d * DIA);
  const daqui = (d: number) => new Date(Date.now() + d * DIA);
  const FOTOS = { foto_pessoa: 'https://r2/visitantes/r.jpg', foto_documento: 'https://r2/visitantes/d.jpg' };

  /** Avaliador mínimo do subconjunto de filtros Prisma usado pela rotina. */
  function casa(linha: any, where: any): boolean {
    return Object.entries(where ?? {}).every(([k, cond]: [string, any]) => {
      if (k === 'AND') return (cond as any[]).every((w) => casa(linha, w));
      if (k === 'OR') return (cond as any[]).some((w) => casa(linha, w));
      if (k === 'NOT') return !casa(linha, cond);
      const v = linha[k];
      if (cond === null) return v == null;
      if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
        if ('some' in cond) return Array.isArray(v) && v.some((x: any) => casa(x, cond.some));
        if ('in' in cond) return cond.in.includes(v);
        if ('not' in cond && cond.not === null) return v != null;
        if ('lte' in cond) return v != null && +v <= +cond.lte;
        if ('gt' in cond) return v != null && +v > +cond.gt;
      }
      return v === cond;
    });
  }

  const visita = (o: any) => ({ data_saida: null, data_hora_termino: null, data_entrada: null, data_hora_inicio: null, created_at: ha(200), ...o });
  const visitantes = [
    { id: 1, ...FOTOS, ...visita({ data_hora_termino: ha(100) }) },            // autorização acabou há 100 dias
    { id: 2, ...FOTOS, ...visita({ created_at: ha(100) }) },                   // sem saída nem término
    { id: 3, ...FOTOS, ...visita({ data_hora_termino: daqui(5) }) },           // ainda autorizada
    { id: 4, ...FOTOS, ...visita({ data_saida: ha(100) }) },                   // encerrada (já funcionava)
    { id: 5, ...FOTOS, ...visita({ created_at: ha(10) }) },                    // recente
  ];
  const pessoas = [
    { id: 11, ...FOTOS, updated_at: ha(200), visitas: [visita({ data_hora_termino: ha(100) })] },
    { id: 12, ...FOTOS, updated_at: ha(100), visitas: [] },                    // visita cancelada/apagada
    { id: 13, ...FOTOS, updated_at: ha(10), visitas: [] },                     // sem visita, mexida há pouco
    { id: 14, ...FOTOS, updated_at: ha(200), visitas: [visita({ data_hora_termino: daqui(5) })] },
    { id: 15, ...FOTOS, updated_at: ha(200), visitas: [visita({ data_saida: ha(100) }), visita({ created_at: ha(5) })] },
  ];

  function build() {
    const prisma: any = {
      isConnected: true,
      visitantes: {
        findMany: jest.fn(async ({ where }: any) => visitantes.filter((v) => casa(v, where))),
        updateMany: jest.fn(async ({ where }: any) => ({ count: where.id.in.length })),
      },
      pessoas: {
        findMany: jest.fn(async ({ where }: any) => pessoas.filter((p) => casa(p, where))),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    };
    const svc = new VisitantesService(
      prisma, {} as any, { deleteUrl: jest.fn(async () => undefined) } as any, {} as any,
      { registrar: jest.fn(async () => undefined) } as any, {} as any, {} as any, {} as any,
    );
    return { svc, prisma };
  }

  it('legado: expurga pela autorização vencida ou pela última atividade quando não há saída', async () => {
    const { svc, prisma } = build();
    await svc.tickRetencaoDadosVisitantes(90);
    const ids = prisma.visitantes.updateMany.mock.calls[0][0].where.id.in;
    expect([...ids].sort()).toEqual([1, 2, 4]);
  });

  it('Pessoas: visita nunca encerrada e Pessoa sem visita entram; autorização vigente e atividade recente não', async () => {
    const { svc, prisma } = build();
    await svc.tickRetencaoDadosVisitantes(90);
    const ids = prisma.pessoas.updateMany.mock.calls.map(([a]: any) => a.where.id).sort();
    expect(ids).toEqual([11, 12]);
  });
});
