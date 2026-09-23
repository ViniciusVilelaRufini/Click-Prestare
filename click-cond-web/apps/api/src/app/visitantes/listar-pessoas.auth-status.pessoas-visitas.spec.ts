import { VisitantesService } from './visitantes.service';

/**
 * O modal "Autorização de Acesso" da portaria (portaria remota) lê
 * `auth_status` / `auth_solicitado_em` / `auth_respondido_em` no nível da
 * PESSOA. O caminho legado (Visitantes) emite esses campos; o caminho
 * Pessoas/Visitas só os emitia dentro de cada apartamento. Resultado: com a
 * migração ligada, o modal mostrava "Sem autorização ativa" mesmo com o
 * pedido pendente ou já autorizado pelo morador no app.
 */
describe('listarPessoas (Pessoas/Visitas) — estado da autorização no nível da pessoa', () => {
  const original = process.env['PESSOAS_MIGRATION_ENABLED'];
  afterEach(() => {
    if (original === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = original;
  });

  function servico(visita: Record<string, unknown>, anteriores: Record<string, unknown>[] = []) {
    const agora = Date.now();
    const pessoa = {
      id: 2000001,
      id_condominio: 1,
      nome: 'QA_SECURITY_20260923_Visitante',
      doc_identificacao: null,
      telefone: null,
      foto_pessoa: null,
      foto_documento: null,
      face_id: null,
      face_sync_status: null,
      face_enrolled_at: null,
      bloqueado: 0,
      created_at: new Date(agora - 60 * 60 * 1000),
      visitas: [
        {
          id: 1000001,
          id_pessoa: 2000001,
          id_condominio: 1,
          is_visitante: 1,
          is_prestador: 0,
          liberado: 0,
          bloqueado: 0,
          codigo_acesso: null,
          data_entrada: null,
          data_saida: null,
          data_hora_inicio: null,
          data_hora_termino: null,
          dias_semana: null,
          categorias: null,
          created_at: new Date(agora - 30 * 60 * 1000),
          apartamento: { id: 101, bloco: 'A', apto: '101' },
          ...visita,
        },
        ...anteriores.map((a, i) => ({
          id: 1000000 - i - 1,
          id_pessoa: 2000001,
          id_condominio: 1,
          is_visitante: 1,
          is_prestador: 0,
          liberado: 0,
          bloqueado: 0,
          codigo_acesso: null,
          data_hora_inicio: null,
          data_hora_termino: null,
          dias_semana: null,
          categorias: null,
          created_at: new Date(agora - 5 * 60 * 60 * 1000),
          apartamento: { id: 101, bloco: 'A', apto: '101' },
          ...a,
        })),
      ],
    };
    const prisma: any = {
      isConnected: true,
      pessoas: { findMany: jest.fn().mockResolvedValue([pessoa]) },
      visitas: { findMany: jest.fn().mockResolvedValue([]) },
      visitantes: { findMany: jest.fn().mockResolvedValue([]) },
      vagas: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const noop: any = { registrar: jest.fn(), emit: jest.fn() };
    return new VisitantesService(prisma, noop, { isDataUrl: () => false } as any, {} as any, noop, {} as any, noop);
  }

  it('pedido pendente aparece na pessoa', async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const solicitado = new Date(Date.now() - 60 * 1000);
    const [p]: any[] = await servico({ auth_status: 'pendente', auth_solicitado_em: solicitado }).listarPessoas(1);
    expect(p.auth_status).toBe('pendente');
    expect(p.auth_solicitado_em).toBe(solicitado.toISOString());
  });

  it('autorização do morador aparece na pessoa', async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const solicitado = new Date(Date.now() - 2 * 60 * 1000);
    const respondido = new Date(Date.now() - 60 * 1000);
    const [p]: any[] = await servico({
      auth_status: 'autorizado',
      liberado: 1,
      auth_solicitado_em: solicitado,
      auth_respondido_em: respondido,
    }).listarPessoas(1);
    expect(p.auth_status).toBe('autorizado');
    expect(p.auth_respondido_em).toBe(respondido.toISOString());
  });

  it('sem pedido, continua sem estado', async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const [p]: any[] = await servico({}).listarPessoas(1);
    expect(p.auth_status).toBeNull();
  });

  describe('datas da visita atual (não misturar visitas diferentes)', () => {
    const saidaAntiga = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const entradaAntiga = new Date(Date.now() - 3 * 60 * 60 * 1000 - 5000);
    const anterior = { data_entrada: entradaAntiga, data_saida: saidaAntiga };

    it('dentro agora por uma visita nova: data_entrada da atual e SEM data_saida (a saída é da visita antiga)', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
      const entradaAgora = new Date(Date.now() - 60 * 1000);
      const [p]: any[] = await servico({ liberado: 1, data_entrada: entradaAgora }, [anterior]).listarPessoas(1);
      expect(p.data_entrada).toBe(entradaAgora.toISOString());
      expect(p.data_saida).toBeNull();
      expect(p.ultEntrada).toBe(entradaAgora.toISOString());
      expect(p.ultSaida).toBe(saidaAntiga.toISOString());
    });

    it('liberado de novo depois de uma visita antiga: visita atual sem entrada nem saída', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
      const [p]: any[] = await servico({ liberado: 1 }, [anterior]).listarPessoas(1);
      expect(p.data_entrada).toBeNull();
      expect(p.data_saida).toBeNull();
      expect(p.ultSaida).toBe(saidaAntiga.toISOString());
    });
  });

  describe('autorização do morador vencida (check-in seria recusado)', () => {
    it('visita não usada com autorização de 30 min atrás sai como autorizacao_expirada', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
      const [p]: any[] = await servico({
        auth_status: 'autorizado',
        liberado: 1,
        auth_solicitado_em: new Date(Date.now() - 31 * 60 * 1000),
        auth_respondido_em: new Date(Date.now() - 30 * 60 * 1000),
      }).listarPessoas(1);
      expect(p.apartamentosVisitados[0].autorizacao_expirada).toBe(true);
      expect(p.autorizacao_expirada).toBe(true);
    });

    it('autorização recente não está expirada', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
      const [p]: any[] = await servico({
        auth_status: 'autorizado',
        liberado: 1,
        auth_respondido_em: new Date(Date.now() - 60 * 1000),
      }).listarPessoas(1);
      expect(p.apartamentosVisitados[0].autorizacao_expirada).toBe(false);
      expect(p.autorizacao_expirada).toBe(false);
    });
  });
});

