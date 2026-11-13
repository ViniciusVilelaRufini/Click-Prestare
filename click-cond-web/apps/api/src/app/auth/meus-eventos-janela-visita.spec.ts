import { MobileAuthService } from './mobile-auth.service';

/**
 * O feed do morador buscava Acessos_Facial pelo id da Pessoa sem condomínio nem tempo: toda passagem
 * do prestador que já visitou a unidade dele (inclusive atendendo OUTRO apartamento) aparecia, e o
 * id polimórfico podia casar evento de outro condomínio.
 */
describe('getMeusEventos (morador) — só eventos do condomínio e da janela das visitas dele', () => {
  const ENV = process.env['PESSOAS_MIGRATION_ENABLED'];
  afterEach(() => {
    if (ENV === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = ENV;
  });

  const DIA = 24 * 60 * 60 * 1000;
  const ha = (dias: number) => new Date(Date.now() - dias * DIA);

  function build(visitas: any[], visitantes: any[], acessos: any[]) {
    const prisma: any = {
      isConnected: true,
      moradores: { findMany: jest.fn(async () => []) },
      apartamentos_Users: { findMany: jest.fn(async () => [{ id_apto: 101 }]) },
      visitas: { findMany: jest.fn(async () => visitas) },
      visitantes: { findMany: jest.fn(async () => visitantes) },
      acessos_Facial: { findMany: jest.fn(async ({ where }: any) => (where.tipo_pessoa === 'morador' ? [] : acessos)) },
      condominios: { findMany: jest.fn(async () => [{ id: 1, nome: 'Cond A' }, { id: 2, nome: 'Cond B' }]) },
    };
    const svc = new MobileAuthService(
      prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    return { svc, prisma };
  }
  const ev = (id: number, id_condominio: number, id_pessoa: number, timestamp: Date, nome: string) => ({
    id, id_condominio, id_pessoa, timestamp, nome_pessoa: nome, evento: 'entrada',
    tipo_pessoa: 'visitante', tipo_dispositivo: 'facial', confianca: 0.9,
  });

  it('Pessoas/Visitas: passagem da mesma Pessoa fora da visita à unidade e evento de outro condomínio ficam fora', async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    // V1: visita da Pessoa 2000001 ao apto 101, de 25 a 20 dias atrás.
    const v1 = {
      id: 1000001, id_pessoa: 2000001, id_condominio: 1, is_prestador: 1,
      created_at: ha(25), data_hora_inicio: ha(25), data_hora_termino: ha(20), data_entrada: ha(25), data_saida: ha(20),
      pessoa: { nome: 'Prestador P', tipo_pessoa: 'prestador', foto_pessoa: null },
    };
    const { svc, prisma } = build([v1], [], [
      ev(1, 1, 2000001, ha(5), 'Fora da visita'),        // mesma Pessoa, atendendo outra unidade
      ev(2, 2, 1000001, ha(22), 'Outro condominio'),      // id colidindo, outro condomínio
      ev(3, 1, 2000001, ha(22), 'Dentro da visita'),
    ]);
    const nomes = (await svc.getMeusEventos(9, 15, 'Morador')).map((e: any) => e.nome);
    expect(nomes).toContain('Dentro da visita');
    expect(nomes).not.toContain('Fora da visita');
    expect(nomes).not.toContain('Outro condominio');
    const chamada = prisma.acessos_Facial.findMany.mock.calls.find(([a]: any) => a.where.tipo_pessoa?.in);
    expect(chamada[0].where.id_condominio).toEqual({ in: [1] });
  });

  it('legado (Visitantes): id colidindo em outro condomínio fica fora', async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';
    const v = {
      id: 30, nome: 'Visitante V', id_condominio: 1, is_prestador: 0,
      created_at: ha(3), data_hora_inicio: ha(3), data_hora_termino: null, data_entrada: ha(3), data_saida: null, foto_pessoa: null,
    };
    const { svc } = build([], [v], [ev(4, 2, 30, ha(1), 'Outro condominio'), ev(5, 1, 30, ha(1), 'Mesmo condominio')]);
    const nomes = (await svc.getMeusEventos(9, 15, 'Morador')).map((e: any) => e.nome);
    expect(nomes).toContain('Mesmo condominio');
    expect(nomes).not.toContain('Outro condominio');
  });
});
