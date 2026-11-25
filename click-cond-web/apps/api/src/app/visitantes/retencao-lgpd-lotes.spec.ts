import { VisitantesService } from './visitantes.service';
import { ConvitesService } from '../convites/convites.service';

/**
 * J7 da revisão dos ciclos (jobs): o expurgo LGPD apagava no máximo 200
 * visitantes + 200 pessoas (e 500 convites) por dia — acima disso o atraso dos
 * 90 dias só crescia. E o tick engolia o próprio erro e devolvia void, então
 * `executarComLock` marcava o período mesmo quando falhou.
 *
 * Agora cada passada laça em lotes até esvaziar, com teto de tempo; a passada
 * agendada devolve false (não marca o período) se falhou ou se parou no teto
 * com trabalho pendente, e o tick é horário (o período mínimo segue 24 h).
 */
function lote(n: number, base: number) {
  return Array.from({ length: n }, (_, i) => ({ id: base + i, foto_pessoa: `https://r2/${base + i}.jpg`, foto_documento: null }));
}

describe('Retenção LGPD de visitantes — em lotes até esvaziar', () => {
  function build() {
    const prisma: any = {
      isConnected: true,
      visitantes: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(async ({ where }: any) => ({ count: where.id.in.length })),
      },
      pessoas: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const storage: any = { deleteUrl: jest.fn().mockResolvedValue(undefined) };
    const auditoria: any = { registrar: jest.fn().mockResolvedValue(undefined) };
    const svc = new VisitantesService(prisma, {} as any, storage, {} as any, auditoria, {} as any, {} as any, {} as any);
    return { svc, prisma, auditoria };
  }

  /** A consulta "outras linhas com a mesma foto" (id notIn) não faz parte do lote. */
  function filaDeLotes(prisma: any, tabela: 'visitantes' | 'pessoas', lotes: any[][]) {
    prisma[tabela].findMany.mockImplementation(async (args: any) => {
      if (args?.where?.id?.notIn) return [];
      return lotes.shift() ?? [];
    });
  }

  it('visitantes: 200 + 200 + 50 numa passada só', async () => {
    const { svc, prisma, auditoria } = build();
    filaDeLotes(prisma, 'visitantes', [lote(200, 1), lote(200, 1000), lote(50, 5000)]);

    const r = await svc.expurgarRetencaoVisitantes(90);

    expect(prisma.visitantes.updateMany).toHaveBeenCalledTimes(3);
    expect(r).toEqual({ total: 450, completo: true });
    // Uma auditoria com o total, não uma por lote.
    expect(auditoria.registrar).toHaveBeenCalledTimes(1);
    expect(auditoria.registrar.mock.calls[0][0].detalhes.totalExpurgados).toBe(450);
  });

  it('pessoas: também laça até o lote vir incompleto', async () => {
    const { svc, prisma } = build();
    filaDeLotes(prisma, 'pessoas', [lote(200, 1), lote(3, 900)]);

    const r = await svc.expurgarRetencaoVisitantes(90);

    expect(r).toEqual({ total: 203, completo: true });
  });

  it('teto de tempo: para com trabalho pendente e diz que não completou', async () => {
    const { svc, prisma } = build();
    prisma.visitantes.findMany.mockImplementation(async (args: any) => (args?.where?.id?.notIn ? [] : lote(200, 1)));

    const r = await svc.expurgarRetencaoVisitantes(90, 0);

    expect(prisma.visitantes.updateMany).toHaveBeenCalledTimes(1);
    expect(r.completo).toBe(false);
  });

  it('passada agendada: false (não marca o período) se falhou ou se ficou pendente; true se esvaziou', async () => {
    const { svc, prisma } = build();
    await expect(svc.rodarRetencaoAgendada()).resolves.toBe(true);

    prisma.visitantes.findMany.mockRejectedValue(new Error('banco fora'));
    await expect(svc.rodarRetencaoAgendada()).resolves.toBe(false);

    prisma.visitantes.findMany.mockImplementation(async (args: any) => (args?.where?.id?.notIn ? [] : lote(200, 1)));
    jest.spyOn(svc, 'expurgarRetencaoVisitantes').mockResolvedValueOnce({ total: 200, completo: false });
    await expect(svc.rodarRetencaoAgendada()).resolves.toBe(false);
  });

  it('o tick público continua devolvendo o total (e 0 em erro)', async () => {
    const { svc, prisma } = build();
    filaDeLotes(prisma, 'visitantes', [lote(2, 1)]);
    await expect(svc.tickRetencaoDadosVisitantes(90)).resolves.toBe(2);
    prisma.visitantes.findMany.mockRejectedValue(new Error('x'));
    await expect(svc.tickRetencaoDadosVisitantes(90)).resolves.toBe(0);
  });
});

describe('Retenção de convites — em lotes até esvaziar', () => {
  function build(lotes: any[][]) {
    const prisma: any = {
      isConnected: true,
      convites_Visita: {
        findMany: jest.fn(async () => lotes.shift() ?? []),
        deleteMany: jest.fn(async ({ where }: any) => ({ count: where.id.in.length })),
      },
    };
    const storage: any = { enabled: true, deleteUrl: jest.fn().mockResolvedValue(undefined) };
    const consent: any = { descartarConvite: jest.fn().mockResolvedValue(undefined) };
    const svc = new ConvitesService(prisma, storage, {} as any, {} as any, consent);
    return { svc, prisma };
  }
  const convites = (n: number, base: number) => Array.from({ length: n }, (_, i) => ({ id: base + i, foto_url: null }));

  it('500 + 500 + 10 numa passada', async () => {
    const { svc, prisma } = build([convites(500, 1), convites(500, 1000), convites(10, 5000)]);
    const r = await svc.expurgarConvitesMortos();
    expect(prisma.convites_Visita.deleteMany).toHaveBeenCalledTimes(3);
    expect(r).toEqual({ total: 1010, completo: true });
  });

  it('teto de tempo e passada agendada', async () => {
    const { svc } = build([convites(500, 1), convites(500, 1000)]);
    const r = await svc.expurgarConvitesMortos(undefined, 0);
    expect(r).toEqual({ total: 500, completo: false });

    const falha = build([]);
    falha.prisma.convites_Visita.findMany.mockRejectedValue(new Error('banco fora'));
    await expect(falha.svc.rodarRetencaoAgendada()).resolves.toBe(false);
    await expect(build([]).svc.rodarRetencaoAgendada()).resolves.toBe(true);
  });
});
