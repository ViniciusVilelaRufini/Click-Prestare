import { FacialService } from './facial.service';

/**
 * Caminho legado (PESSOAS_MIGRATION_ENABLED desligada): o histórico de acesso do visitante buscava os
 * eventos faciais só por `id_pessoa`, sem `id_condominio` — evento de outro condomínio com o mesmo
 * número de pessoa aparecia no histórico deste visitante.
 */
describe('FacialService.listAcessosPessoa (legado) — eventos só do condomínio do visitante', () => {
  const antes = process.env['PESSOAS_MIGRATION_ENABLED'];
  // O construtor arma timers de re-sincronização (mesma convenção dos specs vizinhos).
  beforeEach(() => {
    jest.useFakeTimers();
    delete process.env['PESSOAS_MIGRATION_ENABLED'];
  });
  afterEach(() => jest.useRealTimers());
  afterAll(() => {
    if (antes === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = antes;
  });

  const eventos = [
    { id: 1, id_condominio: 1, id_device: 1, tipo_dispositivo: 'facial', face_id: 'v_300', tipo_pessoa: 'visitante', id_pessoa: 300, nome_pessoa: 'Visitante', evento: 'entrada', confianca: 0.9, timestamp: new Date('2026-11-02T10:00:00Z') },
    { id: 2, id_condominio: 2, id_device: 9, tipo_dispositivo: 'facial', face_id: 'v_300', tipo_pessoa: 'visitante', id_pessoa: 300, nome_pessoa: 'Outro', evento: 'entrada', confianca: 0.9, timestamp: new Date('2026-11-03T10:00:00Z') },
  ];

  function build() {
    const casa = (a: any, where: any) =>
      a.tipo_pessoa === where.tipo_pessoa &&
      where.id_pessoa.in.includes(a.id_pessoa) &&
      (where.id_condominio === undefined || a.id_condominio === where.id_condominio);
    const visitante = { id: 300, id_condominio: 1, nome: 'Visitante', doc_identificacao: '123', data_entrada: null, data_saida: null };
    const prisma: any = {
      isConnected: true,
      visitantes: {
        findUnique: jest.fn(async () => ({ ...visitante })),
        findMany: jest.fn(async () => [{ ...visitante }]),
      },
      acessos_Facial: { findMany: jest.fn(async ({ where }: any) => eventos.filter((a) => casa(a, where))) },
    };
    const svc = new FacialService(
      prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    return { svc, prisma };
  }

  it('filtra os eventos faciais pelo condomínio do visitante', async () => {
    const { svc, prisma } = build();
    const lista = await svc.listAcessosPessoa('visitante', 300, 30);
    expect(prisma.acessos_Facial.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id_condominio: 1 }) }),
    );
    expect(lista.map((a: any) => a.id)).toEqual([1]);
  });
});
