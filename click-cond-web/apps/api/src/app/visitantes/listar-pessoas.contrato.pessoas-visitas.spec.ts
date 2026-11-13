import { VisitantesService } from './visitantes.service';

/**
 * No caminho Pessoas/Visitas, `listarPessoas` não devolvia campos que o
 * caminho legado (Visitantes) devolve e que a portaria usa:
 *  - `is_prestador`/`is_visitante`: /prestadores ficava vazia e o prestador
 *    aparecia em /visitantes como "Visitante"; editar só o nome virava o
 *    prestador em visitante;
 *  - `tag_rfid`: editar só o nome apagava a tag;
 *  - `id_apartamento`/`statusLabel`: modal de Solicitar sem unidade, Dashboard
 *    sem "Na portaria agora";
 *  - negativa do morador e pedido vencido não chegavam à tela: a linha caía na
 *    janela da visita e mostrava "Autorizado" + Registrar Entrada.
 */
describe('listarPessoas (Pessoas/Visitas) — mesmo contrato do legado', () => {
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

  function visita(id: number, criadaHa: number, extra: Record<string, unknown> = {}) {
    return {
      id,
      id_pessoa: 2000007,
      id_condominio: 1,
      id_apartamento: 6,
      is_visitante: 1,
      is_prestador: 0,
      liberado: 0,
      bloqueado: 0,
      codigo_acesso: null,
      tag_rfid: null,
      data_entrada: null,
      data_saida: null,
      data_hora_inicio: new Date(Date.now() - H),
      data_hora_termino: new Date(Date.now() + 3 * H),
      dias_semana: null,
      categorias: null,
      auth_status: null,
      created_at: new Date(Date.now() - criadaHa),
      apartamento: { id: 6, bloco: 'A', apto: '106' },
      ...extra,
    };
  }

  function servico(visitas: Record<string, unknown>[], pessoaExtra: Record<string, unknown> = {}) {
    const pessoa = {
      id: 2000007,
      id_condominio: 1,
      nome: 'QA_Contrato',
      doc_identificacao: null,
      telefone: null,
      foto_pessoa: null,
      foto_documento: null,
      tipo_pessoa: 'visitante',
      face_id: null,
      face_sync_status: null,
      face_enrolled_at: null,
      bloqueado: 0,
      created_at: new Date(Date.now() - 2 * H),
      visitas,
      ...pessoaExtra,
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

  it('prestador: is_prestador/is_visitante, unidade e tag da visita', async () => {
    const [p]: any[] = await servico(
      [visita(10, 5 * MIN, { is_prestador: 1, is_visitante: 0, liberado: 1, tag_rfid: 'TAG-1' })],
      { tipo_pessoa: 'prestador' },
    ).listarPessoas(1);
    expect(p.is_prestador).toBe(1);
    expect(p.is_visitante).toBe(0);
    expect(p.id_apartamento).toBe(6);
    expect(p.tag_rfid).toBe('TAG-1');
    expect(p.statusLabel).toBe('Liberado');
  });

  it('tag de uma visita que não é a principal ainda aparece na pessoa', async () => {
    const [p]: any[] = await servico([
      visita(10, 2 * H, { tag_rfid: 'TAG-ANTIGA', data_entrada: new Date(Date.now() - H), data_saida: new Date(Date.now() - 30 * MIN) }),
      visita(11, 5 * MIN, { liberado: 1 }),
    ]).listarPessoas(1);
    expect(p.id).toBe(11);
    expect(p.tag_rfid).toBe('TAG-ANTIGA');
  });

  it('statusLabel: dentro é "No condomínio"; sem nada ativo é "Histórico"', async () => {
    const [dentro]: any[] = await servico([visita(10, 5 * MIN, { liberado: 1, data_entrada: new Date() })]).listarPessoas(1);
    expect(dentro.statusLabel).toBe('No condomínio');
    const [hist]: any[] = await servico([visita(10, 5 * MIN)]).listarPessoas(1);
    expect(hist.statusLabel).toBe('Histórico');
  });

  it('morador negou o pedido mais recente: auth_status "negado" na unidade e na pessoa', async () => {
    const [p]: any[] = await servico([
      visita(10, 5 * MIN, {
        auth_status: 'negado',
        auth_solicitado_em: new Date(Date.now() - 4 * MIN),
        auth_respondido_em: new Date(Date.now() - 3 * MIN),
      }),
    ]).listarPessoas(1);
    expect(p.apartamentosVisitados[0].auth_status).toBe('negado');
    expect(p.auth_status).toBe('negado');
    expect(p.liberado).toBe(0);
  });

  it('negado e depois liberado pela portaria: não é mais "negado"', async () => {
    const [p]: any[] = await servico([
      visita(10, 5 * MIN, {
        liberado: 1,
        auth_status: 'negado',
        auth_solicitado_em: new Date(Date.now() - 4 * MIN),
        auth_respondido_em: new Date(Date.now() - 3 * MIN),
      }),
    ]).listarPessoas(1);
    expect(p.apartamentosVisitados[0].auth_status).toBeNull();
    expect(p.auth_status).toBeNull();
  });

  it('negativa antiga não vale depois de uma visita mais nova', async () => {
    const [p]: any[] = await servico([
      visita(10, 3 * H, { auth_status: 'negado', auth_respondido_em: new Date(Date.now() - 3 * H) }),
      visita(11, 5 * MIN, { liberado: 1 }),
    ]).listarPessoas(1);
    expect(p.auth_status).toBeNull();
    expect(p.apartamentosVisitados[0].auth_status).toBeNull();
  });

  it('pedido sem resposta há mais de 10 min: pedido_expirado na unidade e na pessoa', async () => {
    const [p]: any[] = await servico([
      visita(10, 20 * MIN, { auth_status: 'pendente', auth_solicitado_em: new Date(Date.now() - 15 * MIN) }),
    ]).listarPessoas(1);
    expect(p.auth_status).toBeNull();
    expect(p.apartamentosVisitados[0].pedido_expirado).toBe(true);
    expect(p.pedido_expirado).toBe(true);
  });

  it('pedido recente não está expirado', async () => {
    const [p]: any[] = await servico([
      visita(10, 5 * MIN, { auth_status: 'pendente', auth_solicitado_em: new Date(Date.now() - 2 * MIN) }),
    ]).listarPessoas(1);
    expect(p.auth_status).toBe('pendente');
    expect(p.apartamentosVisitados[0].pedido_expirado).toBe(false);
    expect(p.pedido_expirado).toBe(false);
  });

  it('pessoa sem nenhuma visita: liberado 0 (não "Liberado")', async () => {
    const [p]: any[] = await servico([]).listarPessoas(1);
    expect(p.liberado).toBe(0);
    // Sem visita não há id de VISITA: o id da Pessoa ali acertava a visita de outra pessoa.
    expect(p.id).toBeNull();
    expect(p.id_pessoa).toBe(2000007);
    expect(p.totalVisitas).toBe(0);
    expect(p.statusLabel).toBe('Histórico');
    expect(p.is_prestador).toBe(0);
  });
});
