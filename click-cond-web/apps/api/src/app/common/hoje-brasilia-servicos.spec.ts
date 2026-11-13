import { MobileAuthService } from '../auth/mobile-auth.service';
import { AreasSociaisService } from '../areas-sociais/areas-sociais.service';
import { FacialService } from '../facial/facial.service';
import { CrmFaturasService } from '../crm/crm-faturas.service';

/**
 * O servidor roda em UTC. Às 23:30 de Brasília (02:30Z do dia seguinte) o "hoje"
 * montado com setHours(0,0,0,0) já era o dia seguinte: contadores zeravam e
 * contas que vencem hoje apareciam como vencidas. Relógio fixado nesse horário.
 */
describe('"hoje" no fuso de Brasília às 23:30 (02:30Z)', () => {
  const tzOriginal = process.env.TZ;
  const pessoasOriginal = process.env['PESSOAS_MIGRATION_ENABLED'];
  const INICIO = new Date('2026-11-11T03:00:00.000Z'); // 00:00 BRT do dia 11
  const FIM = new Date('2026-11-12T02:59:59.999Z'); //   23:59:59.999 BRT do dia 11
  const HOJE_DATA = new Date('2026-11-11T00:00:00.000Z'); // coluna @db.Date

  beforeAll(() => {
    process.env.TZ = 'UTC';
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
  });
  afterAll(() => {
    process.env.TZ = tzOriginal;
    process.env['PESSOAS_MIGRATION_ENABLED'] = pessoasOriginal;
  });
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-12T02:30:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  const dia = (d: Date) => d.toISOString();

  it('resumo do morador: visitas de hoje cobrem o dia de Brasília', async () => {
    const count = jest.fn().mockResolvedValue(0);
    const prisma: any = {
      isConnected: true,
      apartamentos_Users: { findMany: jest.fn().mockResolvedValue([{ id_apto: 7 }]) },
      visitas: { count },
      moradores: { findMany: jest.fn().mockResolvedValue([]) },
      encomendas: { count: jest.fn().mockResolvedValue(0) },
    };
    const svc = Object.create(MobileAuthService.prototype) as any;
    svc.prisma = prisma;

    await svc.getSummary(41, 'Morador');

    const [r0, r1] = count.mock.calls[0][0].where.OR;
    expect(dia(r0.data_entrada.gte)).toBe(dia(INICIO));
    expect(dia(r0.data_entrada.lte)).toBe(dia(FIM));
    expect(dia(r1.data_hora_inicio.gte)).toBe(dia(INICIO));
    expect(dia(r1.data_hora_inicio.lte)).toBe(dia(FIM));
  });

  it('resumo do funcionário: visitas de hoje cobrem o dia de Brasília', async () => {
    const count = jest.fn().mockResolvedValue(0);
    const prisma: any = {
      isConnected: true,
      funcionarios: { findFirst: jest.fn().mockResolvedValue({ id_condominio: 3 }) },
      encomendas: { count: jest.fn().mockResolvedValue(0) },
      visitas: { count },
      ocorrencias: { count: jest.fn().mockResolvedValue(0) },
    };
    const svc = Object.create(MobileAuthService.prototype) as any;
    svc.prisma = prisma;
    svc.tenant = { recorteOcorrenciasPrivadas: jest.fn().mockResolvedValue(null) };

    await svc.getSummary(41, 'Funcionario');

    const [r0, r1] = count.mock.calls[0][0].where.OR;
    expect(dia(r0.data_entrada.gte)).toBe(dia(INICIO));
    expect(dia(r0.data_entrada.lte)).toBe(dia(FIM));
    expect(dia(r1.data_hora_inicio.gte)).toBe(dia(INICIO));
    expect(dia(r1.data_hora_inicio.lte)).toBe(dia(FIM));
  });

  it('notificações: conta que vence hoje (data_vencimento @db.Date) não é "vencida" à noite', async () => {
    const prisma: any = {
      isConnected: true,
      users: {
        findUnique: jest.fn().mockResolvedValue({
          notif_encomendas: 0, notif_comunicados: 0, notif_ocorrencias: 0, notif_visitantes: 0,
        }),
      },
      moradores: { findMany: jest.fn().mockResolvedValue([]) },
      apartamentos_Users: { findMany: jest.fn().mockResolvedValue([]) },
      financeiro: {
        findMany: jest.fn().mockResolvedValue([
          { id: 1, nome: 'Condomínio', valor: 100, data_vencimento: HOJE_DATA },
          { id: 2, nome: 'Anterior', valor: 100, data_vencimento: new Date('2026-11-10T00:00:00Z') },
        ]),
      },
      areas_Sociais_Agendamentos: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = Object.create(MobileAuthService.prototype) as any;
    svc.prisma = prisma;

    const itens = await svc.getNotificacoes(41);
    const fin = (id: number) => itens.find((i: any) => i.id === `financeiro-${id}`);
    expect(fin(1).titulo).toBe('Conta a vencer');
    expect(fin(2).titulo).toBe('Conta vencida');
  });

  it('Meus agendamentos: a reserva de hoje (@db.Date) continua na lista', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma: any = {
      isConnected: true,
      apartamentos_Users: { findMany: jest.fn().mockResolvedValue([{ id_apto: 7 }]) },
      areas_Sociais_Agendamentos: { findMany },
    };
    const svc = Object.create(AreasSociaisService.prototype) as any;
    svc.prisma = prisma;
    svc.tenant = { assertCondominio: jest.fn() };

    await svc.getAllMeusAgendamentos(1, 41, undefined, { sub: 41 } as any);

    const where = findMany.mock.calls[0][0].where;
    expect(dia(where.data.gte)).toBe(dia(HOJE_DATA));
  });

  it('fila de reservas do síndico: a reserva de hoje (@db.Date) continua na lista', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const svc = Object.create(AreasSociaisService.prototype) as any;
    svc.prisma = { isConnected: true, areas_Sociais_Agendamentos: { findMany } };
    svc.tenant = { assertCondominio: jest.fn() };

    await svc.getAllAgendamentos(1, { sub: 1, role: 'sindico', typeAccess: 'Sindico' } as any);

    expect(dia(findMany.mock.calls[0][0].where.data.gte)).toBe(dia(HOJE_DATA));
  });

  it('ocupação das áreas: eventos contados a partir de 00:00 de Brasília', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    const svc = Object.create(AreasSociaisService.prototype) as any;
    svc.prisma = { $queryRaw: queryRaw };

    await svc.getOcupacaoPorArea(1);

    const valores = queryRaw.mock.calls[0].slice(1);
    const datas = valores.filter((v: any) => v instanceof Date).map(dia);
    expect(datas).toEqual([dia(INICIO)]);
  });

  it('saúde do facial: remoções de fantasmas "hoje" começam à meia-noite de Brasília', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const svc = Object.create(FacialService.prototype) as any;
    svc.prisma = { isConnected: true, auditLog: { findMany } };
    svc.listDevices = jest.fn().mockResolvedValue([]);
    svc.agent = { lastSeenAt: jest.fn() };
    svc._estado = { obter: jest.fn().mockResolvedValue(null) };

    await svc.getHealthSummary(1);

    expect(dia(findMany.mock.calls[0][0].where.created_at.gte)).toBe(dia(INICIO));
  });

  it('faturas do CRM: vencimento hoje (@db.Date) não vira "vencida" à noite', async () => {
    const prisma: any = {
      isConnected: true,
      crm_Faturas: {
        findMany: jest.fn().mockResolvedValue([
          { id: 1, id_condominio: 1, referencia: '11/2026', valor: 10, vencimento: HOJE_DATA, status: 'pendente' },
          { id: 2, id_condominio: 1, referencia: '10/2026', valor: 10, vencimento: new Date('2026-11-10T00:00:00Z'), status: 'pendente' },
        ]),
      },
      condominios: { findMany: jest.fn().mockResolvedValue([{ id: 1, nome: 'X' }]) },
    };
    const svc = Object.create(CrmFaturasService.prototype) as any;
    svc.prisma = prisma;

    const r = await svc.listarFaturas();
    expect(r.find((f: any) => f.id === 1).status).toBe('pendente');
    expect(r.find((f: any) => f.id === 2).status).toBe('vencida');
  });
});
