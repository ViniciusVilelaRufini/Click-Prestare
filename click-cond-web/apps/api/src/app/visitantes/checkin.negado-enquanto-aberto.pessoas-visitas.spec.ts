import { VisitantesService } from './visitantes.service';

/**
 * Rodada 3, item 4A: o porteiro abre "Registrar Entrada" com o pedido ainda
 * pendente e, enquanto o modal está aberto, o morador nega no app. A tela
 * confirmava a entrada com a cópia antiga e a API gravava `liberado: 1` por
 * cima da negativa. Agora a tela manda o `auth_status` que viu (`esperado`) e
 * a API recusa com 409 quando a negativa chegou depois disso.
 */
describe('check-in (Pessoas/Visitas) — negativa que chegou com o modal aberto', () => {
  const original = process.env['PESSOAS_MIGRATION_ENABLED'];
  afterEach(() => {
    if (original === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = original;
  });

  function montar(extra: Record<string, unknown>) {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const pessoa = { id: 2000001, nome: 'QA_Negado', bloqueado: 0 };
    const visita: any = {
      id: 1000004, id_pessoa: 2000001, id_condominio: 1, id_apartamento: 106, user: 7,
      is_visitante: 1, is_prestador: 0, data_hora_inicio: null, data_hora_termino: null,
      data_entrada: null, data_saida: null, codigo_acesso: null, liberado: 0, bloqueado: 0,
      auth_status: 'negado', auth_solicitado_em: new Date(Date.now() - 60_000),
      auth_respondido_em: new Date(Date.now() - 10_000),
      ...extra,
    };
    const rel = (v: any) => ({ ...v, pessoa, apartamento: { bloco: 'A', apto: '106' } });
    const prisma: any = {
      isConnected: true,
      visitas: { update: jest.fn(async ({ data }: any) => rel(Object.assign(visita, data))) },
    };
    const svc = new VisitantesService(
      prisma, {} as any, {} as any, {} as any, { registrar: jest.fn() } as any, {} as any,
      { emitToCondominio: jest.fn() } as any,
    );
    const s = svc as any;
    jest.spyOn(s, 'assertPodeAcessarVisita').mockImplementation(async () => rel(visita));
    jest.spyOn(s, 'fireFacialSyncPessoa').mockImplementation(() => undefined);
    return { svc, prisma, visita };
  }

  const porteiro = { sub: 3, nome: 'Portaria', id_condominio: 1, turno: 'Manha' } as any;

  it('a tela viu "pendente" e o morador negou: 409 e nada é gravado', async () => {
    const { svc, prisma, visita } = montar({});
    await expect(svc.checkIn(1000004, porteiro, undefined, 'pendente')).rejects.toMatchObject({ status: 409 });
    expect(prisma.visitas.update).not.toHaveBeenCalled();
    expect(visita.liberado).toBe(0);
  });

  it('a tela viu "sem pedido" (null) e há negativa: 409', async () => {
    const { svc } = montar({});
    await expect(svc.checkIn(1000004, porteiro, undefined, null)).rejects.toMatchObject({ status: 409 });
  });

  it('o porteiro já sabia da negativa (esperado "negado"): a entrada é registrada', async () => {
    const { svc, visita } = montar({});
    await svc.checkIn(1000004, porteiro, undefined, 'negado');
    expect(visita.data_entrada).toBeInstanceOf(Date);
  });

  it('quem não manda `esperado` (app, versões antigas) segue como antes', async () => {
    const { svc, visita } = montar({});
    await svc.checkIn(1000004, porteiro);
    expect(visita.data_entrada).toBeInstanceOf(Date);
  });

  it('pendente que virou autorizado: a entrada segue', async () => {
    const { svc, visita } = montar({ auth_status: 'autorizado', liberado: 1 });
    await svc.checkIn(1000004, porteiro, undefined, 'pendente');
    expect(visita.data_entrada).toBeInstanceOf(Date);
  });
});
