import { VisitantesService } from './visitantes.service';

/**
 * Rodada 3, item 17: a recarga da portaria (20 s; 4 s com pedido aberto)
 * carregava TODAS as visitas de cada pessoa — o custo crescia com o histórico.
 * Agora cada pessoa traz só as visitas mais recentes, mais as que ainda estão
 * em aberto (dentro, liberada, pedido pendente ou PIN) mesmo que antigas; o
 * total de visitas vem da contagem do banco.
 */
describe('listarPessoas (Pessoas/Visitas) — carga limitada de visitas', () => {
  const original = process.env['PESSOAS_MIGRATION_ENABLED'];
  beforeEach(() => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
  });
  afterEach(() => {
    if (original === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = original;
  });

  const H = 60 * 60 * 1000;
  const visita = (id: number, extra: Record<string, unknown> = {}) => ({
    id, id_pessoa: 2000001, id_condominio: 1, id_apartamento: 6, is_visitante: 1, is_prestador: 0,
    liberado: 0, bloqueado: 0, codigo_acesso: null, data_entrada: new Date(Date.now() - 30 * H),
    data_saida: new Date(Date.now() - 29 * H), data_hora_inicio: null, data_hora_termino: null,
    dias_semana: null, categorias: null, auth_status: null, created_at: new Date(Date.now() - 31 * H),
    apartamento: { id: 6, bloco: 'A', apto: '106' },
    ...extra,
  });

  function montar(recentes: any[], abertas: any[], total: number, porUnidade: any[] = []) {
    const pessoa = {
      id: 2000001, id_condominio: 1, nome: 'QA_Historico', doc_identificacao: null, telefone: null,
      foto_pessoa: null, foto_documento: null, face_id: null, face_sync_status: null, face_enrolled_at: null,
      bloqueado: 0, created_at: new Date(Date.now() - 900 * H), visitas: recentes, _count: { visitas: total },
    };
    const prisma: any = {
      isConnected: true,
      pessoas: { findMany: jest.fn(async () => [pessoa]) },
      visitas: { findMany: jest.fn(async () => abertas), groupBy: jest.fn(async () => porUnidade) },
      vagas: { findMany: jest.fn(async () => []) },
    };
    const svc = new VisitantesService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    return { svc, prisma };
  }

  it('pede só as visitas mais recentes de cada pessoa e a contagem total', async () => {
    const { svc, prisma } = montar([visita(1000050)], [], 1);
    await svc.listarPessoas(1);
    const args = prisma.pessoas.findMany.mock.calls[0][0];
    expect(args.include.visitas.take).toBeGreaterThan(0);
    expect(args.include._count).toEqual({ select: { visitas: true } });
  });

  it('visita antiga ainda em aberto (pessoa dentro) entra na linha', async () => {
    const dentro = visita(1000001, { data_entrada: new Date(Date.now() - 800 * H), data_saida: null, liberado: 1 });
    const { svc, prisma } = montar([visita(1000050)], [dentro], 60);
    const [p]: any[] = await svc.listarPessoas(1);
    expect(p.noLocal).toBe(true);
    expect(p.id).toBe(1000001);
    // A busca das abertas é recortada ao condomínio e às pessoas da página.
    expect(prisma.visitas.findMany.mock.calls[0][0].where).toEqual(
      expect.objectContaining({ id_condominio: 1, id_pessoa: { in: [2000001] } }),
    );
  });

  it('a mesma visita vinda nas duas consultas aparece uma vez só', async () => {
    const aberta = visita(1000050, { data_entrada: null, data_saida: null, liberado: 1 });
    const { svc } = montar([aberta], [aberta], 1);
    const [p]: any[] = await svc.listarPessoas(1);
    expect(p.apartamentosVisitados[0].totalVisitasApto).toBe(1);
  });

  it('total de visitas vem da contagem do banco', async () => {
    const { svc } = montar([visita(1000050)], [], 60);
    const [p]: any[] = await svc.listarPessoas(1);
    expect(p.totalVisitas).toBe(60);
  });

  // Revisão M-4: visita já usada que mantém a liberação (prestador, recorrente,
  // vaga) fora das 20 mais recentes também decide a linha.
  it('a busca das abertas inclui as usadas que seguem liberadas', async () => {
    const { svc, prisma } = montar([visita(1000050)], [], 1);
    await svc.listarPessoas(1);
    const where = prisma.visitas.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where.OR)).toContain('"data_saida":{"not":null}');
  });

  it('prestador liberado numa unidade antiga: a unidade aparece liberada', async () => {
    const antiga = visita(1000001, { is_prestador: 1, liberado: 1, id_apartamento: 7, apartamento: { id: 7, bloco: 'B', apto: '201' } });
    const { svc } = montar([visita(1000050)], [antiga], 60);
    const [p]: any[] = await svc.listarPessoas(1);
    const u = p.apartamentosVisitados.find((a: any) => a.id === 7);
    expect(u?.liberado).toBe(true);
  });

  it('totalVisitasApto vem da contagem por unidade do banco', async () => {
    const { svc } = montar([visita(1000050)], [], 60, [{ id_pessoa: 2000001, id_apartamento: 6, _count: { _all: 42 } }]);
    const [p]: any[] = await svc.listarPessoas(1);
    expect(p.apartamentosVisitados[0].totalVisitasApto).toBe(42);
  });
});
