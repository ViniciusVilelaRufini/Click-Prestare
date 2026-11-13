import { MobileAuthService } from './mobile-auth.service';

/**
 * Feed do morador: o evento facial de um visitante/prestador só é dele se cair na janela de uma visita dele.
 * A janela ficava aberta "até agora" quando a visita tinha entrada sem saída (ignorando o término agendado)
 * ou não tinha entrada nem término: passagens da mesma Pessoa por OUTRAS unidades do condomínio, dias
 * depois, apareciam no feed. E o `take: 40` era aplicado antes do filtro da janela, descartando eventos
 * legítimos quando os mais recentes eram de fora.
 */
describe('getMeusEventos (morador) — fim da janela da visita e corte depois do filtro', () => {
  const ENV = process.env['PESSOAS_MIGRATION_ENABLED'];
  beforeEach(() => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
  });
  afterEach(() => {
    if (ENV === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = ENV;
  });

  const H = 60 * 60 * 1000;
  const DIA = 24 * H;
  const ha = (ms: number) => new Date(Date.now() - ms);

  function build(visitas: any[], acessos: any[]) {
    const prisma: any = {
      isConnected: true,
      moradores: { findMany: jest.fn(async () => []) },
      apartamentos_Users: { findMany: jest.fn(async () => [{ id_apto: 101 }]) },
      visitas: { findMany: jest.fn(async () => visitas) },
      visitantes: { findMany: jest.fn(async () => []) },
      // Respeita orderBy desc + take, como o banco.
      acessos_Facial: {
        findMany: jest.fn(async ({ where, take }: any) => {
          if (where.tipo_pessoa === 'morador') return [];
          const ord = [...acessos].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
          return take ? ord.slice(0, take) : ord;
        }),
      },
      condominios: { findMany: jest.fn(async () => [{ id: 1, nome: 'Cond A' }]) },
    };
    const svc = new MobileAuthService(
      prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    return { svc, prisma };
  }
  const visita = (extra: any) => ({
    id: 1000001, id_pessoa: 2000001, id_condominio: 1, is_prestador: 1,
    data_saida: null, data_hora_termino: null,
    pessoa: { nome: 'Prestador P', tipo_pessoa: 'prestador', foto_pessoa: null },
    ...extra,
  });
  let seq = 1;
  const ev = (timestamp: Date, nome: string) => ({
    id: seq++, id_condominio: 1, id_pessoa: 2000001, timestamp, nome_pessoa: nome, evento: 'entrada',
    tipo_pessoa: 'prestador', tipo_dispositivo: 'facial', confianca: 0.9,
  });

  it('visita com entrada e sem saída: o término agendado fecha a janela (não fica aberta até agora)', async () => {
    const entrada = ha(5 * DIA);
    const v = visita({
      created_at: entrada, data_hora_inicio: entrada, data_entrada: entrada,
      data_hora_termino: new Date(entrada.getTime() + 2 * H),
    });
    const { svc } = build([v], [
      ev(new Date(entrada.getTime() + 30 * 60 * 1000), 'Dentro da visita'),
      ev(ha(1 * DIA), 'Outra unidade dias depois'),
    ]);
    const nomes = (await svc.getMeusEventos(9, 15, 'Morador')).map((e: any) => e.nome);
    expect(nomes).toContain('Dentro da visita');
    expect(nomes).not.toContain('Outra unidade dias depois');
  });

  it('visita sem entrada e sem término: janela tem teto curto a partir do início', async () => {
    const inicio = ha(5 * DIA);
    const v = visita({ created_at: inicio, data_hora_inicio: inicio, data_entrada: null });
    const { svc } = build([v], [
      ev(new Date(inicio.getTime() + 2 * H), 'Perto do inicio'),
      ev(ha(1 * DIA), 'Outra unidade dias depois'),
    ]);
    const nomes = (await svc.getMeusEventos(9, 15, 'Morador')).map((e: any) => e.nome);
    expect(nomes).toContain('Perto do inicio');
    expect(nomes).not.toContain('Outra unidade dias depois');
  });

  it('visita com entrada, sem saída e sem término: teto curto a partir da entrada', async () => {
    const entrada = ha(4 * DIA);
    const v = visita({ created_at: ha(6 * DIA), data_hora_inicio: ha(6 * DIA), data_entrada: entrada });
    const { svc } = build([v], [
      ev(new Date(entrada.getTime() + 3 * H), 'Logo depois da entrada'),
      ev(ha(1 * DIA), 'Outra unidade dias depois'),
    ]);
    const nomes = (await svc.getMeusEventos(9, 15, 'Morador')).map((e: any) => e.nome);
    expect(nomes).toContain('Logo depois da entrada');
    expect(nomes).not.toContain('Outra unidade dias depois');
  });

  it('o corte de 40 é aplicado depois do filtro da janela (eventos recentes de fora não expulsam os legítimos)', async () => {
    const entrada = ha(10 * DIA);
    const v = visita({
      created_at: entrada, data_hora_inicio: entrada, data_entrada: entrada,
      data_saida: new Date(entrada.getTime() + 3 * H),
    });
    const fora = Array.from({ length: 45 }, (_, i) => ev(ha(1 * DIA + i * 60 * 1000), 'Fora'));
    const dentro = Array.from({ length: 3 }, (_, i) => ev(new Date(entrada.getTime() + (i + 1) * 30 * 60 * 1000), `Dentro ${i}`));
    const { svc } = build([v], [...fora, ...dentro]);
    const nomes = (await svc.getMeusEventos(9, 15, 'Morador')).map((e: any) => e.nome);
    expect(nomes).toEqual(expect.arrayContaining(['Dentro 0', 'Dentro 1', 'Dentro 2']));
    expect(nomes).not.toContain('Fora');
  });

  it('depois do filtro, os eventos de visitantes continuam limitados a 40', async () => {
    const entrada = ha(2 * DIA);
    const v = visita({
      created_at: entrada, data_hora_inicio: entrada, data_entrada: entrada,
      data_saida: new Date(entrada.getTime() + 10 * H),
    });
    const dentro = Array.from({ length: 60 }, (_, i) => ev(new Date(entrada.getTime() + (i + 1) * 5 * 60 * 1000), `D${i}`));
    const { svc } = build([v], dentro);
    const r = await svc.getMeusEventos(9, 50, 'Morador');
    // 40 faciais + entrada/saída manuais da visita (sem facial no mesmo instante).
    expect(r.filter((e: any) => e.tipo_dispositivo === 'facial')).toHaveLength(40);
  });
});
