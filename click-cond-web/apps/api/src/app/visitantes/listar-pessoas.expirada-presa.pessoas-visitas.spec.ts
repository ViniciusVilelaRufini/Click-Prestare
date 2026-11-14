import { VisitantesService } from './visitantes.service';

/**
 * Uma autorização do morador que venceu sem ser usada ficava para sempre como a
 * visita "principal" da pessoa e marcava a linha como "Autorização expirada" —
 * mesmo depois de a pessoa entrar e sair por visitas mais novas. A portaria
 * dava baixa e a linha voltava a "expirada" (nunca "Saiu"), sem como pedir
 * autorização de novo ao morador.
 */
describe('listarPessoas (Pessoas/Visitas) — autorização vencida antiga não prende a pessoa', () => {
  const original = process.env['PESSOAS_MIGRATION_ENABLED'];
  beforeEach(() => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
  });
  afterEach(() => {
    if (original === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = original;
  });

  const MIN = 60 * 1000;
  const H = 60 * MIN;
  const ID_NOVA = 1000055;
  const ID_ANTIGA = 1000033;

  function visita(id: number, criadaHa: number, extra: Record<string, unknown> = {}) {
    return {
      id,
      id_pessoa: 2000006,
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
      created_at: new Date(Date.now() - criadaHa),
      apartamento: { id: 6, bloco: 'A', apto: '106' },
      ...extra,
    };
  }

  /** Autorizada pelo morador há muito tempo e nunca usada. */
  function antigaAutorizadaNaoUsada() {
    return visita(ID_ANTIGA, 40 * 24 * H, {
      liberado: 1,
      auth_status: 'autorizado',
      auth_solicitado_em: new Date(Date.now() - 40 * 24 * H),
      auth_respondido_em: new Date(Date.now() - 40 * 24 * H + MIN),
    });
  }

  function servico(visitas: Record<string, unknown>[]) {
    const pessoa = {
      id: 2000006,
      id_condominio: 1,
      nome: 'QA_Visitante_Expirado',
      doc_identificacao: null,
      telefone: null,
      foto_pessoa: null,
      foto_documento: null,
      face_id: null,
      face_sync_status: null,
      face_enrolled_at: null,
      bloqueado: 0,
      created_at: new Date(Date.now() - 41 * 24 * H),
      visitas,
    };
    const prisma: any = {
      isConnected: true,
      pessoas: { findMany: jest.fn().mockResolvedValue([pessoa]) },
      visitas: { findMany: jest.fn().mockResolvedValue([]), groupBy: jest.fn().mockResolvedValue([]) },
      visitantes: { findMany: jest.fn().mockResolvedValue([]) },
      vagas: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const noop: any = { registrar: jest.fn(), emit: jest.fn() };
    return new VisitantesService(prisma, noop, { isDataUrl: () => false } as any, {} as any, noop, {} as any, noop);
  }

  it('entrou e saiu por uma visita nova: a linha é a visita nova (saiu), não a antiga expirada', async () => {
    const entrada = new Date(Date.now() - 20 * MIN);
    const saida = new Date(Date.now() - 10 * MIN);
    const [p]: any[] = await servico([
      antigaAutorizadaNaoUsada(),
      visita(ID_NOVA, 21 * MIN, { liberado: 0, data_entrada: entrada, data_saida: saida }),
    ]).listarPessoas(1);

    expect(p.id).toBe(ID_NOVA);
    expect(p.data_saida).toBe(saida.toISOString());
    expect(p.autorizacao_expirada).toBe(false);
    expect(p.apartamentosVisitados[0].autorizacao_expirada).toBe(false);
    // A ação da linha ("Solicitar") deve mirar a visita mais recente.
    expect(p.apartamentosVisitados[0].visitanteId).toBe(ID_NOVA);
  });

  it('liberada de novo pela portaria depois da autorização vencida: principal é a liberação nova, sem "expirada"', async () => {
    const [p]: any[] = await servico([
      antigaAutorizadaNaoUsada(),
      visita(ID_NOVA, 2 * MIN, { liberado: 1 }),
    ]).listarPessoas(1);

    expect(p.id).toBe(ID_NOVA);
    expect(p.liberado).toBe(1);
    expect(p.autorizacao_expirada).toBe(false);
  });

  it('pedido pendente vencido e antigo não passa na frente da visita de hoje', async () => {
    const saida = new Date(Date.now() - 10 * MIN);
    const [p]: any[] = await servico([
      visita(ID_ANTIGA, 40 * 24 * H, {
        auth_status: 'pendente',
        auth_solicitado_em: new Date(Date.now() - 40 * 24 * H),
      }),
      visita(ID_NOVA, 21 * MIN, { data_entrada: new Date(Date.now() - 20 * MIN), data_saida: saida }),
    ]).listarPessoas(1);

    expect(p.id).toBe(ID_NOVA);
    expect(p.auth_status).toBeNull();
  });

  it('a autorização vencida é a visita mais recente: continua "expirada" (o check-in seria recusado)', async () => {
    const [p]: any[] = await servico([
      visita(ID_ANTIGA, 40 * 24 * H, { data_entrada: new Date(Date.now() - 40 * 24 * H), data_saida: new Date(Date.now() - 40 * 24 * H + H) }),
      visita(ID_NOVA, 31 * MIN, {
        liberado: 1,
        auth_status: 'autorizado',
        auth_solicitado_em: new Date(Date.now() - 31 * MIN),
        auth_respondido_em: new Date(Date.now() - 30 * MIN),
      }),
    ]).listarPessoas(1);

    expect(p.id).toBe(ID_NOVA);
    expect(p.autorizacao_expirada).toBe(true);
    expect(p.apartamentosVisitados[0].autorizacao_expirada).toBe(true);
  });

  it('autorização do morador ainda válida continua na frente de uma visita mais nova sem autorização', async () => {
    const respondido = new Date(Date.now() - 2 * MIN);
    const [p]: any[] = await servico([
      visita(ID_ANTIGA, 5 * MIN, {
        liberado: 1,
        auth_status: 'autorizado',
        auth_solicitado_em: new Date(Date.now() - 3 * MIN),
        auth_respondido_em: respondido,
      }),
      visita(ID_NOVA, 1 * MIN, {}),
    ]).listarPessoas(1);

    expect(p.id).toBe(ID_ANTIGA);
    expect(p.auth_status).toBe('autorizado');
    expect(p.autorizacao_expirada).toBe(false);
  });
});
