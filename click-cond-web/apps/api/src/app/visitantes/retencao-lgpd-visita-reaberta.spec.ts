import { VisitantesService } from './visitantes.service';

/**
 * Expurgo LGPD (90 dias) apagava foto de quem está em uso:
 *  - legado: `checkIn`/`liberarAcesso` reabrem a MESMA linha Visitantes (data_saida volta a null)
 *    sem mexer em `data_hora_termino`; com término antigo, a cláusula "sem saída, autorização
 *    vencida" pegava o visitante dentro do prédio ou recém-liberado;
 *  - Pessoas: `visitaParaNovaPassagem` cria a Visita nova copiando o término antigo; a proteção
 *    "alguma visita ainda no prazo" só olhava o término quando ele existia.
 */
describe('Expurgo LGPD — visita reaberta ou nova com término vencido herdado', () => {
  const DIA = 24 * 60 * 60 * 1000;
  const ha = (d: number) => new Date(Date.now() - d * DIA);
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
        if ('notIn' in cond) return !cond.notIn.includes(v);
        if ('not' in cond && cond.not === null) return v != null;
        if ('lte' in cond) return v != null && +v <= +cond.lte;
        if ('gt' in cond) return v != null && +v > +cond.gt;
      }
      return v === cond;
    });
  }

  /** Tudo antigo por padrão; término vencido há 100 dias. */
  const visita = (o: any = {}) => ({
    data_saida: null,
    data_hora_termino: ha(100),
    data_entrada: null,
    data_hora_inicio: ha(200),
    created_at: ha(200),
    updated_at: ha(200),
    ...o,
  });

  function build(linhasVisitantes: any[], linhasPessoas: any[]) {
    const prisma: any = {
      isConnected: true,
      visitantes: {
        findMany: jest.fn(async ({ where }: any) => linhasVisitantes.filter((v) => casa(v, where))),
        updateMany: jest.fn(async ({ where }: any) => ({ count: where.id.in.length })),
      },
      pessoas: {
        findMany: jest.fn(async ({ where }: any) => linhasPessoas.filter((p) => casa(p, where))),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    };
    const storage: any = { deleteUrl: jest.fn(async () => undefined) };
    const svc = new VisitantesService(
      prisma, {} as any, storage, {} as any,
      { registrar: jest.fn(async () => undefined) } as any, {} as any, {} as any, {} as any,
    );
    return { svc, prisma, storage };
  }

  const idsLegadoExpurgados = (prisma: any): number[] =>
    prisma.visitantes.updateMany.mock.calls.flatMap(([a]: any) => a.where.id.in).sort();
  const idsPessoasExpurgadas = (prisma: any): number[] =>
    prisma.pessoas.updateMany.mock.calls.map(([a]: any) => a.where.id).sort();

  describe('legado: linha Visitantes reaberta por checkIn/liberarAcesso', () => {
    it('visitante dentro do prédio (check-in agora, término antigo) não perde a foto', async () => {
      const { svc, prisma, storage } = build(
        [{ id: 51, ...FOTOS, ...visita({ data_entrada: ha(0), updated_at: ha(0) }) }],
        [],
      );
      await svc.tickRetencaoDadosVisitantes(90);
      expect(idsLegadoExpurgados(prisma)).toEqual([]);
      expect(storage.deleteUrl).not.toHaveBeenCalled();
    });

    it('visitante recém-liberado (data_entrada nula, updated_at agora, término antigo) não perde a foto', async () => {
      const { svc, prisma, storage } = build(
        [{ id: 52, ...FOTOS, ...visita({ updated_at: ha(0) }) }],
        [],
      );
      await svc.tickRetencaoDadosVisitantes(90);
      expect(idsLegadoExpurgados(prisma)).toEqual([]);
      expect(storage.deleteUrl).not.toHaveBeenCalled();
    });

    it('entrada recente sozinha também protege', async () => {
      const { svc, prisma } = build([{ id: 53, ...FOTOS, ...visita({ data_entrada: ha(5) }) }], []);
      await svc.tickRetencaoDadosVisitantes(90);
      expect(idsLegadoExpurgados(prisma)).toEqual([]);
    });

    it('controle: término vencido sem atividade recente continua sendo expurgado', async () => {
      const { svc, prisma } = build(
        [
          { id: 54, ...FOTOS, ...visita() },
          { id: 55, ...FOTOS, ...visita({ data_entrada: ha(150), updated_at: ha(100) }) },
          { id: 56, ...FOTOS, ...visita({ data_entrada: ha(0), updated_at: ha(0) }) },
        ],
        [],
      );
      await svc.tickRetencaoDadosVisitantes(90);
      expect(idsLegadoExpurgados(prisma)).toEqual([54, 55]);
    });
  });

  describe('Pessoas: Visita nova sem saída com término antigo herdado', () => {
    it.each([
      ['created_at', { created_at: ha(1), updated_at: ha(1) }],
      ['updated_at', { updated_at: ha(1) }],
      ['data_entrada (pessoa dentro)', { data_entrada: ha(1) }],
      ['data_hora_inicio', { data_hora_inicio: ha(1) }],
    ])('%s recente protege a foto da Pessoa', async (_rotulo, recente) => {
      const { svc, prisma, storage } = build(
        [],
        [
          {
            id: 61,
            ...FOTOS,
            updated_at: ha(200),
            visitas: [visita({ data_saida: ha(150) }), visita(recente)],
          },
        ],
      );
      await svc.tickRetencaoDadosVisitantes(90);
      expect(idsPessoasExpurgadas(prisma)).toEqual([]);
      expect(storage.deleteUrl).not.toHaveBeenCalled();
    });

    it('controle: Pessoa com visitas todas antigas (término vencido, sem atividade recente) continua sendo expurgada', async () => {
      const { svc, prisma } = build(
        [],
        [
          { id: 62, ...FOTOS, updated_at: ha(200), visitas: [visita({ data_saida: ha(150) }), visita()] },
          { id: 63, ...FOTOS, updated_at: ha(200), visitas: [visita({ created_at: ha(1), updated_at: ha(1) })] },
        ],
      );
      await svc.tickRetencaoDadosVisitantes(90);
      expect(idsPessoasExpurgadas(prisma)).toEqual([62]);
    });
  });
});
