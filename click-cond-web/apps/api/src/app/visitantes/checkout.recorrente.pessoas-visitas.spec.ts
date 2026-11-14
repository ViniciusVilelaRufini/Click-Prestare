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
      vagas: { findFirst: jest.fn(async () => null), updateMany: jest.fn(async () => ({ count: 0 })) },
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
      vagas: { findFirst: jest.fn(async () => null), updateMany: jest.fn(async () => ({ count: 0 })) },
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
  ])('%s: recorrente com término futuro sai e continua liberado; sem término, término vencido ou avulso perde', async (_, montar, tabela) => {
    const id = tabela === 'visitas' ? 1000004 : 77;
    const H = 60 * 60 * 1000;
    const rec = montar({ dias_semana: 'seg,qua', data_hora_termino: new Date(Date.now() + 30 * 24 * H) });
    await rec.svc.checkOut(id, porteiro);
    expect(rec.prisma[tabela].update.mock.calls[0][0].data.liberado).toBe(1);

    // Sem término virava acesso permanente: perde como visitante comum.
    const semTermino = montar({ dias_semana: 'seg,qua', data_hora_termino: null });
    await semTermino.svc.checkOut(id, porteiro);
    expect(semTermino.prisma[tabela].update.mock.calls[0][0].data.liberado).toBe(0);

    const vencido = montar({ dias_semana: 'seg,qua', data_hora_termino: new Date(Date.now() - H) });
    await vencido.svc.checkOut(id, porteiro);
    expect(vencido.prisma[tabela].update.mock.calls[0][0].data.liberado).toBe(0);

    const avulso = montar({});
    await avulso.svc.checkOut(id, porteiro);
    expect(avulso.prisma[tabela].update.mock.calls[0][0].data.liberado).toBe(0);
  });
});
