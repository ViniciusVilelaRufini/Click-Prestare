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

  function servico(visita: Record<string, unknown>) {
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
});
