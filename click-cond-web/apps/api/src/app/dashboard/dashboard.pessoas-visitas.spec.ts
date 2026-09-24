import { DashboardService } from './dashboard.service';

/**
 * `summary()` conta visitantes ainda no condomínio e lista as 15
 * entradas/saídas mais recentes. Task "Lote C": essas três leituras migram
 * para `Visitas`/`Pessoas` sob a flag, achatando `pessoa` de volta pro
 * formato que o resto do método (nome/doc/foto na raiz) já espera.
 */
describe('DashboardService — summary() (Pessoas/Visitas)', () => {
  const originalFlag = process.env['PESSOAS_MIGRATION_ENABLED'];

  afterEach(() => {
    if (originalFlag === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = originalFlag;
  });

  function build() {
    const visitanteLegado = {
      id: 1,
      nome: 'Carlos Visitante',
      doc_identificacao: '999',
      foto_pessoa: 'foto.jpg',
      foto_documento: null,
      is_prestador: 0,
      data_entrada: new Date('2026-01-01T10:00:00Z'),
      data_saida: null,
      created_at: new Date('2026-01-01T09:00:00Z'),
      apartamento: { bloco: 'A', apto: '101' },
      criadoPor: { name: 'Morador Teste' },
    };
    const visitaMigrada = {
      id: 501,
      is_prestador: 0,
      data_entrada: new Date('2026-01-01T10:00:00Z'),
      data_saida: null,
      created_at: new Date('2026-01-01T09:00:00Z'),
      apartamento: { bloco: 'A', apto: '101' },
      criadoPor: { name: 'Morador Teste' },
      pessoa: { id: 800, nome: 'Carlos Visitante', doc_identificacao: '999', foto_pessoa: 'foto.jpg', foto_documento: null },
    };

    const prisma: any = {
      isConnected: true,
      visitantes: {
        count: jest.fn(async () => 1),
        findMany: jest.fn(async () => [visitanteLegado]),
      },
      visitas: {
        count: jest.fn(async () => 1),
        findMany: jest.fn(async () => [visitaMigrada]),
      },
      pessoas: {
        findMany: jest.fn(async () => []),
      },
      prestadores_servico: { count: jest.fn(async () => 0) },
      ocorrencias: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      encomendas: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      comunicados: { count: jest.fn(async () => 0) },
      apartamentos: { count: jest.fn(async () => 5) },
      moradores: { count: jest.fn(async () => 10) },
      acessos_Facial: { findMany: jest.fn(async () => []) },
      auditLog: { findMany: jest.fn(async () => []) },
      facial_Devices: { findMany: jest.fn(async () => []) },
    };
    const svc = new DashboardService(prisma);
    return { svc, prisma, visitanteLegado, visitaMigrada };
  }

  it('flag OFF: conta e lista contra Visitantes, nunca toca Visitas', async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';
    const { svc, prisma } = build();
    const r = await svc.summary(1);
    expect(r.visitantesAtivos).toBe(1);
    expect(prisma.visitantes.count).toHaveBeenCalled();
    expect(prisma.visitantes.findMany).toHaveBeenCalled();
    expect(prisma.visitas.count).not.toHaveBeenCalled();
    expect(prisma.visitas.findMany).not.toHaveBeenCalled();

    const entrada = r.ultimosEventos.find((e) => e.detalhes.nome === 'Carlos Visitante');
    expect(entrada).toBeDefined();
    expect(entrada!.detalhes.documento).toBe('999');
  });

  it('flag ON: conta e lista contra Visitas+Pessoa, nunca toca Visitantes, e achata nome/doc corretamente', async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const { svc, prisma } = build();
    const r = await svc.summary(1);
    expect(r.visitantesAtivos).toBe(1);
    expect(prisma.visitas.count).toHaveBeenCalled();
    expect(prisma.visitas.findMany).toHaveBeenCalled();
    expect(prisma.visitantes.count).not.toHaveBeenCalled();
    expect(prisma.visitantes.findMany).not.toHaveBeenCalled();

    const entrada = r.ultimosEventos.find((e) => e.detalhes.nome === 'Carlos Visitante');
    expect(entrada).toBeDefined();
    expect(entrada!.detalhes.documento).toBe('999');
    expect(entrada!.detalhes.blocoApto).toContain('101');
  });

  it('flag ON: dedup encontra o evento facial gravado com id de Pessoa e não duplica a entrada no feed', async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const { svc, prisma } = build();

    const dataEntrada = new Date('2026-01-01T10:00:00Z');
    // Evento facial gravado com id_pessoa = Pessoa.id (800), NÃO o
    // Visita.id (501) da mesma visita — a ambiguidade documentada no
    // código. Usado nas duas consultas de Acessos_Facial que o método faz
    // (lista recente e histórico por visitante).
    prisma.acessos_Facial.findMany = jest.fn(async () => [
      {
        id: 900, id_condominio: 1, timestamp: dataEntrada, nome_pessoa: 'Carlos Visitante',
        tipo_pessoa: 'visitante', tipo_dispositivo: 'facial', evento: 'entrada',
        confianca: 0.95, id_device: 5, id_pessoa: 800,
      },
    ]);

    const r = await svc.summary(1);

    // Sem o merge dos dois espaços de id, este evento apareceria duas
    // vezes: uma como "Acesso Facial" (id_pessoa=800) e outra como entrada
    // "PIN / Manual" (a versão vinda de Visitas, id=501, não deduplicada).
    const doCarlos = r.ultimosEventos.filter((e) => e.detalhes.nome === 'Carlos Visitante');
    expect(doCarlos).toHaveLength(1);
    expect(doCarlos[0].tipo).toBe('Acesso Facial');
    expect(doCarlos[0].detalhes.metodoLiberacao).toBe('facial');
  });

  it('mostra visitante recorrente como visitante no dashboard, mesmo se o evento facial antigo gravou prestador', async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const { svc, prisma } = build();
    prisma.acessos_Facial.findMany = jest.fn(async () => [{
      id: 902, id_condominio: 1, timestamp: new Date('2026-01-01T11:00:00Z'),
      nome_pessoa: 'Carlos Visitante', tipo_pessoa: 'prestador', tipo_dispositivo: 'facial',
      evento: 'entrada', confianca: 0.9, id_device: 5, id_pessoa: 800,
    }]);
    prisma.pessoas.findMany = jest.fn(async () => [{
      id: 800, foto_pessoa: 'foto.jpg', doc_identificacao: '999', tipo_pessoa: 'visitante',
    }]);

    const resumo = await svc.summary(1);
    const evento = resumo.ultimosEventos.find((e) => e.tipo === 'Acesso Facial');

    expect(evento?.detalhes.tipoPessoa).toBe('visitante');
  });

  it('flag ON: enriquecimento de nome/foto/apto do card "Acesso Facial" resolve corretamente quando id_pessoa é um id de Visita', async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const { svc, prisma, visitaMigrada } = build();

    // Evento facial gravado com id_pessoa = Visita.id (501), o outro
    // espaço possível. `visitantes` (legado) não deve ser consultado; a
    // resolução usa pessoas+visitas.
    prisma.acessos_Facial.findMany = jest.fn(async () => [
      {
        id: 901, id_condominio: 1, timestamp: new Date('2026-01-01T11:00:00Z'),
        nome_pessoa: 'Carlos Visitante', tipo_pessoa: 'visitante', tipo_dispositivo: 'facial',
        evento: 'entrada', confianca: 0.9, id_device: 5, id_pessoa: 501,
      },
    ]);
    prisma.pessoas = { findMany: jest.fn(async () => []) };
    prisma.visitas.findMany = jest.fn(async ({ where }: any) => {
      if (where?.id?.in) {
        // chamada de resolverInfoVisitantesPorIdAcessoFacial
        return where.id.in.includes(501)
          ? [{ id: 501, apartamento: { bloco: 'A', apto: '101' }, pessoa: { foto_pessoa: 'foto.jpg', doc_identificacao: '999' } }]
          : [];
      }
      return [visitaMigrada];
    });

    const r = await svc.summary(1);
    const card = r.ultimosEventos.find((e) => e.tipo === 'Acesso Facial');
    expect(card).toBeDefined();
    expect(card!.detalhes.documento).toBe('999');
    expect(card!.detalhes.blocoApto).toContain('101');
    expect(prisma.visitantes.findMany).not.toHaveBeenCalled();
  });
});
