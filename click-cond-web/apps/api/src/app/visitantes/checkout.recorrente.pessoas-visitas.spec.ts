import { VisitantesService } from './visitantes.service';

/**
 * Visitante recorrente (dias da semana) perdia o acesso na 1ª baixa: a saída
 * zerava `liberado` de todo não-prestador, e o rosto saía do aparelho — na
 * semana seguinte ele não entrava mais. Decisão: visita com `dias_semana`
 * mantém `liberado` na saída, como o prestador. Visitante avulso continua
 * perdendo a liberação na saída.
 */
describe('check-out — visitante recorrente mantém a liberação', () => {
  const original = process.env['PESSOAS_MIGRATION_ENABLED'];
  afterEach(() => {
    if (original === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = original;
  });

  const entrou = new Date(Date.now() - 60 * 60 * 1000);
  const porteiro = { sub: 7, nome: 'QA síndico', id_condominio: 1, typeAccess: 'Sindico' } as any;

  function pessoasVisitas(extra: Record<string, unknown>) {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const visita: any = {
      id: 1000004, id_pessoa: 2000001, id_condominio: 1, id_apartamento: 106, is_visitante: 1, is_prestador: 0,
      data_entrada: entrou, data_saida: null, liberado: 1, bloqueado: 0, dias_semana: null, ...extra,
    };
    const rel = (v: any) => ({ ...v, pessoa: { id: 2000001, nome: 'QA_Recorrente' }, apartamento: { bloco: 'A', apto: '106' } });
    const prisma: any = {
      isConnected: true,
      visitas: { update: jest.fn(async ({ data }: any) => rel(Object.assign(visita, data))) },
      vagas: { updateMany: jest.fn(async () => ({ count: 0 })) },
    };
    const svc = new VisitantesService(
      prisma, {} as any, {} as any, {} as any, { registrar: jest.fn() } as any, {} as any,
      { emitToCondominio: jest.fn() } as any,
    );
    jest.spyOn(svc as any, 'assertPodeAcessarVisita').mockImplementation(async () => rel(visita));
    jest.spyOn(svc as any, 'fireFacialSyncPessoa').mockImplementation(() => undefined);
    return { svc, prisma };
  }

  function legado(extra: Record<string, unknown>) {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';
    const visitante: any = {
      id: 77, id_condominio: 1, id_apartamento: 106, nome: 'QA_Recorrente', is_prestador: 0,
      data_entrada: entrou, data_saida: null, liberado: 1, bloqueado: 0, dias_semana: null, face_id: null, ...extra,
    };
    const prisma: any = {
      isConnected: true,
      visitantes: { update: jest.fn(async ({ data }: any) => Object.assign(visitante, data)) },
      vagas: { updateMany: jest.fn(async () => ({ count: 0 })) },
    };
    const svc = new VisitantesService(
      prisma, {} as any, {} as any, { unsyncVisitante: jest.fn(async () => true), syncVisitante: jest.fn(async () => ({})) } as any,
      { registrar: jest.fn() } as any, {} as any, { emitToCondominio: jest.fn() } as any,
    );
    jest.spyOn(svc as any, 'assertPodeAcessarVisitante').mockImplementation(async () => ({ ...visitante }));
    jest.spyOn(svc as any, 'carregarContextoVisitante').mockResolvedValue(null);
    return { svc, prisma };
  }

  it.each([
    ['Pessoas/Visitas', pessoasVisitas, 'visitas'],
    ['legado', legado, 'visitantes'],
  ])('%s: recorrente sai e continua liberado; avulso perde a liberação', async (_, montar, tabela) => {
    const rec = montar({ dias_semana: 'seg,qua' });
    await rec.svc.checkOut(tabela === 'visitas' ? 1000004 : 77, porteiro);
    expect(rec.prisma[tabela].update.mock.calls[0][0].data.liberado).toBe(1);

    const avulso = montar({});
    await avulso.svc.checkOut(tabela === 'visitas' ? 1000004 : 77, porteiro);
    expect(avulso.prisma[tabela].update.mock.calls[0][0].data.liberado).toBe(0);
  });
});
