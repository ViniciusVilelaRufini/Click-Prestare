import { VisitantesService } from './visitantes.service';

/**
 * A lista da portaria tratava qualquer vaga `ativo = 1` como vigente e forçava
 * a unidade para "Liberado" — inclusive vaga de visitante com `fim` no passado,
 * que o terminal e a contagem de vagas já ignoram.
 */
describe('listarPessoas (Pessoas/Visitas) — vaga de visitante vencida não segura a liberação', () => {
  const original = process.env['PESSOAS_MIGRATION_ENABLED'];
  beforeEach(() => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
  });
  afterEach(() => {
    if (original === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = original;
  });

  const H = 60 * 60 * 1000;

  /** Mock que respeita o filtro de vigência (o `OR` de `whereVagaVigente`). */
  function casa(vaga: any, where: any): boolean {
    if (where?.ativo != null && vaga.ativo !== where.ativo) return false;
    if (where?.id_visita?.in && !where.id_visita.in.includes(vaga.id_visita)) return false;
    if (!where?.OR) return true;
    return where.OR.some((cond: any) => {
      if ('tipo_ocupacao' in cond) return vaga.tipo_ocupacao !== cond.tipo_ocupacao.not;
      if ('fim' in cond && cond.fim === null) return vaga.fim == null;
      if ('fim' in cond && cond.fim?.gt) return vaga.fim != null && vaga.fim > cond.fim.gt;
      return false;
    });
  }

  function servico(fimDaVaga: Date | null) {
    const pessoa = {
      id: 2000001,
      id_condominio: 1,
      nome: 'QA_Vaga_Vencida',
      doc_identificacao: null,
      telefone: null,
      foto_pessoa: null,
      foto_documento: null,
      face_id: null,
      face_sync_status: null,
      face_enrolled_at: null,
      bloqueado: 0,
      created_at: new Date(Date.now() - 48 * H),
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
          data_entrada: new Date(Date.now() - 30 * H),
          data_saida: new Date(Date.now() - 29 * H),
          data_hora_inicio: null,
          data_hora_termino: null,
          dias_semana: null,
          categorias: null,
          created_at: new Date(Date.now() - 31 * H),
          apartamento: { id: 6, bloco: 'A', apto: '106' },
        },
      ],
    };
    const vagas = [
      { id: 1, id_visita: 1000001, ativo: 1, tipo_ocupacao: 'visitante', fim: fimDaVaga, titular: { nome: 'Morador' } },
    ];
    const prisma: any = {
      isConnected: true,
      pessoas: { findMany: jest.fn().mockResolvedValue([pessoa]) },
      visitas: { findMany: jest.fn().mockResolvedValue([]) },
      visitantes: { findMany: jest.fn().mockResolvedValue([]) },
      vagas: { findMany: jest.fn(async ({ where }: any) => vagas.filter((v) => casa(v, where))) },
    };
    const noop: any = { registrar: jest.fn(), emit: jest.fn() };
    return new VisitantesService(prisma, noop, { isDataUrl: () => false } as any, {} as any, noop, {} as any, noop);
  }

  it('vaga com fim no passado: a unidade não aparece liberada nem com vaga', async () => {
    const [p]: any[] = await servico(new Date(Date.now() - 2 * H)).listarPessoas(1);
    expect(p.apartamentosVisitados[0].liberado).toBe(false);
    expect(p.vagaMorador).toBeNull();
  });

  it('vaga ainda vigente: continua liberando a unidade', async () => {
    const [p]: any[] = await servico(new Date(Date.now() + 2 * H)).listarPessoas(1);
    expect(p.apartamentosVisitados[0].liberado).toBe(true);
    expect(p.vagaMorador).toBe('Morador');
  });

  it('vaga sem fim: continua liberando a unidade', async () => {
    const [p]: any[] = await servico(null).listarPessoas(1);
    expect(p.apartamentosVisitados[0].liberado).toBe(true);
  });
});
