import { VisitantesService } from './visitantes.service';

/**
 * Caminho legado (PESSOAS_MIGRATION_ENABLED desligada): os detalhes do visitante buscavam os acessos
 * faciais só por `id_pessoa`, sem `id_condominio` — evento de outro condomínio com o mesmo número de
 * pessoa entrava na timeline deste visitante.
 */
describe('VisitantesService.detalhes (legado) — acessos faciais só do condomínio do visitante', () => {
  const antes = process.env['PESSOAS_MIGRATION_ENABLED'];
  beforeEach(() => delete process.env['PESSOAS_MIGRATION_ENABLED']);
  afterAll(() => {
    if (antes === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = antes;
  });

  const visitante = {
    id: 300,
    id_condominio: 1,
    id_apartamento: 7,
    nome: 'Visitante',
    doc_identificacao: '123',
    data_entrada: null,
    data_saida: null,
    data_hora_inicio: null,
    data_hora_termino: null,
    created_at: new Date('2026-11-01T10:00:00Z'),
    apartamento: { id: 7, bloco: 'A', apto: '10', users: [] },
    criadoPor: { name: 'Morador' },
    condominio: { nome: 'Cond 1', enderecoRel: null },
  };
  const eventos = [
    { id: 1, id_condominio: 1, id_device: 1, tipo_pessoa: 'visitante', id_pessoa: 300, nome_pessoa: 'Visitante', evento: 'entrada', confianca: 0.9, timestamp: new Date('2026-11-02T10:00:00Z') },
    { id: 2, id_condominio: 2, id_device: 9, tipo_pessoa: 'visitante', id_pessoa: 300, nome_pessoa: 'Outro', evento: 'entrada', confianca: 0.9, timestamp: new Date('2026-11-03T10:00:00Z') },
  ];

  function build() {
    const casa = (a: any, where: any) =>
      a.tipo_pessoa === where.tipo_pessoa &&
      where.id_pessoa.in.includes(a.id_pessoa) &&
      (where.id_condominio === undefined || a.id_condominio === where.id_condominio);
    const prisma: any = {
      isConnected: true,
      visitantes: {
        findUnique: jest.fn(async () => ({ ...visitante })),
        findMany: jest.fn(async () => []),
      },
      acessos_Facial: { findMany: jest.fn(async ({ where }: any) => eventos.filter((a) => casa(a, where))) },
      facial_Devices: { findMany: jest.fn(async () => [{ id: 1, nome: 'Facial 1' }, { id: 9, nome: 'Facial outro' }]) },
      vagas: { findFirst: jest.fn(async () => null) },
    };
    const svc = new VisitantesService(
      prisma, {} as any, {} as any, {} as any,
      { registrar: jest.fn(async () => undefined) } as any, {} as any, {} as any, {} as any,
    );
    return { svc, prisma };
  }

  it('filtra os acessos faciais pelo condomínio do visitante', async () => {
    const { svc, prisma } = build();
    const res: any = await svc.detalhes(300);
    expect(prisma.acessos_Facial.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id_condominio: 1 }) }),
    );
    expect(JSON.stringify(res)).not.toContain('Facial outro');
  });
});
