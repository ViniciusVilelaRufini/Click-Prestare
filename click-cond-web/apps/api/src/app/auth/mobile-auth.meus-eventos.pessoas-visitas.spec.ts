import { MobileAuthService } from './mobile-auth.service';

/**
 * `getMeusEventos()` monta o feed "Meus eventos" da home do app. Task
 * "Lote C" — sites 12 (ramo funcionário) e 13 (ramo morador): a metade
 * "manual" (visitas sem passagem pelo terminal facial) migra de
 * `Visitantes` para `Visitas`+`Pessoa`.
 *
 * `Acessos_Facial.id_pessoa` não tem um único espaço de id consistente no
 * caminho migrado (alguns eventos gravam id de `Visita`, outros de
 * `Pessoa` — ver comentário em facial.service.ts, não tocado aqui). Os dois
 * ramos precisam considerar os dois espaços:
 *  - ramo funcionário (12): no dedup contra os eventos faciais já vindos do
 *    terminal (`jaVeioDoFacial`), pra não duplicar um acesso no feed.
 *  - ramo morador (13): no FILTRO que decide quais eventos faciais
 *    pertencem aos visitantes do morador — filtra pela união dos dois
 *    espaços de id dos visitantes dele.
 */
describe('MobileAuthService — getMeusEventos() (Pessoas/Visitas)', () => {
  const originalFlag = process.env['PESSOAS_MIGRATION_ENABLED'];

  afterEach(() => {
    if (originalFlag === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = originalFlag;
  });

  function buildBase(overrides: any = {}) {
    const prisma: any = {
      isConnected: true,
      funcionarios: { findFirst: jest.fn(async () => ({ id_condominio: 1 })) },
      condominios: { findMany: jest.fn(async () => [{ id: 1, nome: 'Condomínio Teste' }]) },
      moradores: { findMany: jest.fn(async () => []) },
      apartamentos_Users: { findMany: jest.fn(async () => []) },
      acessos_Facial: { findMany: jest.fn(async () => []) },
      visitantes: { findMany: jest.fn(async () => []) },
      visitas: { findMany: jest.fn(async () => []) },
      ...overrides,
    };
    const jwt: any = {};
    const mail: any = {};
    const storage: any = {};
    const facial: any = {};
    const tenant: any = {};
    const financeiro: any = {};
    const apartamentosSvc: any = {};
    const notifications: any = {};
    const superlogicaWrite: any = {};
    const svc = new MobileAuthService(
      prisma, jwt, mail, storage, facial, tenant, financeiro, apartamentosSvc, notifications, superlogicaWrite,
    );
    return { svc, prisma };
  }

  describe('ramo funcionário (site 12)', () => {
    it('flag OFF: entradas manuais vêm de Visitantes, nunca toca Visitas', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';
      const { svc, prisma } = buildBase({
        visitantes: {
          findMany: jest.fn(async () => [
            { id: 10, nome: 'Legado', id_condominio: 1, is_prestador: 0, data_entrada: new Date(), data_saida: null },
          ]),
        },
      });
      const eventos: any[] = await svc.getMeusEventos(1, 15, 'Funcionario');
      expect(eventos.some((e) => e.nome === 'Legado')).toBe(true);
      expect(prisma.visitantes.findMany).toHaveBeenCalled();
      expect(prisma.visitas.findMany).not.toHaveBeenCalled();
    });

    it('flag ON: entradas manuais vêm de Visitas+Pessoa, nunca toca Visitantes', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
      const { svc, prisma } = buildBase({
        visitas: {
          findMany: jest.fn(async () => [
            {
              id: 900, id_pessoa: 500, id_condominio: 1, is_prestador: 0,
              data_entrada: new Date(), data_saida: null, pessoa: { nome: 'Migrado' },
            },
          ]),
        },
      });
      const eventos: any[] = await svc.getMeusEventos(1, 15, 'Funcionario');
      expect(eventos.some((e) => e.nome === 'Migrado')).toBe(true);
      expect(prisma.visitas.findMany).toHaveBeenCalled();
      expect(prisma.visitantes.findMany).not.toHaveBeenCalled();
    });

    it('flag ON: dedup encontra o evento facial pelo id de Pessoa mesmo quando a entrada manual carrega o id de Visita', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
      const dataEntrada = new Date();
      const { svc } = buildBase({
        acessos_Facial: {
          // Evento facial gravado com id_pessoa = Pessoa.id (500), não o
          // Visita.id (900) da mesma visita.
          findMany: jest.fn(async () => [
            { id: 1, id_condominio: 1, timestamp: dataEntrada, nome_pessoa: 'Migrado', evento: 'entrada', tipo_pessoa: 'visitante', tipo_dispositivo: 'facial', confianca: 0.9, id_pessoa: 500 },
          ]),
        },
        visitas: {
          findMany: jest.fn(async () => [
            {
              id: 900, id_pessoa: 500, id_condominio: 1, is_prestador: 0,
              data_entrada: dataEntrada, data_saida: null, pessoa: { nome: 'Migrado' },
            },
          ]),
        },
      });
      const eventos: any[] = await svc.getMeusEventos(1, 15, 'Funcionario');
      // Só deve aparecer o evento facial (id positivo) — a entrada manual
      // sintética (id negativo) tem que ter sido suprimida pelo dedup via
      // id_pessoa_alt, senão a mesma entrada apareceria duplicada.
      const doVisitante = eventos.filter((e) => e.nome === 'Migrado');
      expect(doVisitante).toHaveLength(1);
      expect(doVisitante[0].id).toBeGreaterThan(0);
    });
  });

  describe('ramo morador (site 13)', () => {
    function buildMorador(overrides: any = {}) {
      return buildBase({
        moradores: { findMany: jest.fn(async () => [{ id: 1 }]) },
        apartamentos_Users: { findMany: jest.fn(async () => [{ id_apto: 101 }]) },
        condominios: { findMany: jest.fn(async () => [{ id: 1, nome: 'Condomínio Teste' }]) },
        ...overrides,
      });
    }

    it('flag OFF: visitantes vêm de Visitantes, nunca toca Visitas', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';
      const { svc, prisma } = buildMorador({
        visitantes: {
          findMany: jest.fn(async () => [
            { id: 20, nome: 'Legado Morador', id_condominio: 1, is_prestador: 0, data_entrada: new Date(), data_saida: null },
          ]),
        },
      });
      const eventos: any[] = await svc.getMeusEventos(9, 15, undefined);
      expect(eventos.some((e) => e.nome === 'Legado Morador')).toBe(true);
      expect(prisma.visitantes.findMany).toHaveBeenCalled();
      expect(prisma.visitas.findMany).not.toHaveBeenCalled();
    });

    it('flag ON: visitantes vêm de Visitas+Pessoa, nunca toca Visitantes', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
      const { svc, prisma } = buildMorador({
        visitas: {
          findMany: jest.fn(async () => [
            {
              id: 901, id_pessoa: 501, id_condominio: 1, is_prestador: 0,
              data_entrada: new Date(), data_saida: null, pessoa: { nome: 'Migrado Morador' },
            },
          ]),
        },
      });
      const eventos: any[] = await svc.getMeusEventos(9, 15, undefined);
      expect(eventos.some((e) => e.nome === 'Migrado Morador')).toBe(true);
      expect(prisma.visitas.findMany).toHaveBeenCalled();
      expect(prisma.visitantes.findMany).not.toHaveBeenCalled();
    });

    it('flag ON: o filtro de correlação encontra um evento pelo id de Pessoa e outro pelo id de Visita (merge dos dois espaços)', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
      const acessosFacialFindMany = jest.fn(async ({ where }: any) => {
        if (where.tipo_pessoa === 'morador') return [];
        // ramo de visitantes/prestadores — dois eventos, um em cada espaço
        // de id: um com id_pessoa = Pessoa.id (500), outro com
        // id_pessoa = Visita.id (900) do MESMO visitante.
        return [
          {
            id: 1, id_condominio: 1, timestamp: new Date(), nome_pessoa: 'Via Pessoa',
            evento: 'entrada', tipo_pessoa: 'visitante', tipo_dispositivo: 'facial', confianca: 0.9, id_pessoa: 500,
          },
          {
            id: 2, id_condominio: 1, timestamp: new Date(), nome_pessoa: 'Via Visita',
            evento: 'entrada', tipo_pessoa: 'visitante', tipo_dispositivo: 'facial', confianca: 0.9, id_pessoa: 900,
          },
        ];
      });
      const { svc, prisma } = buildMorador({
        acessos_Facial: { findMany: acessosFacialFindMany },
        visitas: {
          findMany: jest.fn(async () => [
            {
              id: 900, id_pessoa: 500, id_condominio: 1, is_prestador: 0,
              data_entrada: null, data_saida: null, pessoa: { nome: 'Visitante X' },
            },
          ]),
        },
      });

      const eventos: any[] = await svc.getMeusEventos(9, 15, undefined);

      // Prova que a query de acessos faciais foi filtrada pela união dos
      // dois espaços de id (900 = Visita.id, 500 = Pessoa.id).
      const chamadaVisEv = prisma.acessos_Facial.findMany.mock.calls.find(
        ([args]: any) => args.where.tipo_pessoa?.in?.includes('visitante'),
      );
      expect(chamadaVisEv).toBeDefined();
      const idsFiltrados = chamadaVisEv[0].where.id_pessoa.in;
      expect(idsFiltrados).toEqual(expect.arrayContaining([900, 500]));

      // Prova que os dois eventos (um em cada espaço) aparecem no feed.
      expect(eventos.some((e) => e.nome === 'Via Pessoa')).toBe(true);
      expect(eventos.some((e) => e.nome === 'Via Visita')).toBe(true);
    });
  });
});
