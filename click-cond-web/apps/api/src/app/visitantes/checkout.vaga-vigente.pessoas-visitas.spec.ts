import { VisitantesService, mantemLiberadoNaSaida } from './visitantes.service';

/**
 * Rodada 3, item 6: visitante com vaga vigente (o morador cedeu por dias).
 * A saída pelo terminal mantém `liberado=1`, mas a baixa manual do console
 * desativava a vaga e soltava o vínculo (`ativo 0`, `id_visita null`): a vaga
 * sumia do painel e do app sem aviso. Agora a baixa trata a vaga vigente como
 * a saída pelo terminal: mantém a liberação e a vaga.
 */
describe('check-out (Pessoas/Visitas) — visitante com vaga vigente', () => {
  const original = process.env['PESSOAS_MIGRATION_ENABLED'];
  afterEach(() => {
    if (original === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = original;
  });

  const porteiro = { sub: 7, nome: 'QA', id_condominio: 1, typeAccess: 'Sindico' } as any;

  function montar(vagaVigente: any) {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const visita: any = {
      id: 1000004, id_pessoa: 2000001, id_condominio: 1, id_apartamento: 106, is_visitante: 1, is_prestador: 0,
      data_entrada: new Date(Date.now() - 3600_000), data_saida: null, liberado: 1, bloqueado: 0, dias_semana: null,
    };
    const rel = (v: any) => ({ ...v, pessoa: { id: 2000001, nome: 'QA_Vaga' }, apartamento: { bloco: 'A', apto: '106' } });
    const prisma: any = {
      isConnected: true,
      visitas: { update: jest.fn(async ({ data }: any) => rel(Object.assign(visita, data))) },
      vagas: {
        findFirst: jest.fn(async () => vagaVigente),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
    };
    const svc = new VisitantesService(
      prisma, {} as any, {} as any, {} as any, { registrar: jest.fn() } as any, {} as any,
      { emitToCondominio: jest.fn() } as any,
    );
    jest.spyOn(svc as any, 'assertPodeAcessarVisita').mockImplementation(async () => rel(visita));
    jest.spyOn(svc as any, 'fireFacialSyncPessoa').mockImplementation(() => undefined);
    return { svc, prisma, visita };
  }

  it('com vaga vigente: a baixa mantém a liberação e não mexe na vaga vigente', async () => {
    const { svc, prisma, visita } = montar({ id: 9, id_visita: 1000004, ativo: 1, fim: new Date(Date.now() + 86_400_000) });
    await svc.checkOut(1000004, porteiro);
    expect(visita.data_saida).toBeInstanceOf(Date);
    expect(visita.liberado).toBe(1);
    // Só as vagas que já não valem são soltas.
    for (const [args] of prisma.vagas.updateMany.mock.calls) {
      expect(args.where.id).toEqual({ not: 9 });
    }
  });

  it('sem vaga vigente: como antes, perde a liberação e a vaga é solta', async () => {
    const { svc, prisma, visita } = montar(null);
    await svc.checkOut(1000004, porteiro);
    expect(visita.liberado).toBe(0);
    expect(prisma.vagas.updateMany).toHaveBeenCalledWith({
      where: { id_visita: 1000004 },
      data: { ativo: 0, id_visita: null, placa: null },
    });
  });

  it('mantemLiberadoNaSaida considera a vaga vigente', () => {
    expect(mantemLiberadoNaSaida({ is_prestador: 0 }, Date.now(), true)).toBe(true);
    expect(mantemLiberadoNaSaida({ is_prestador: 0 }, Date.now(), false)).toBe(false);
  });
});
