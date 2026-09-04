import { MobileAuthService } from './mobile-auth.service';

/**
 * Feed "Meus Eventos" / "Eventos de Acesso" do app (GET /dashboard/meus-eventos).
 *
 * Ele lia só a tabela Acessos_Facial, então entrada registrada na portaria
 * (check-in manual, que grava Visitantes.data_entrada e nada no facial) sumia
 * do app — mesmo já aparecendo no detalhe do prestador e no dashboard da
 * portaria-web, que montam a linha do tempo a partir do próprio registro.
 *
 * O evento manual entra com tipo_dispositivo 'pin' (o app já rotula isso como
 * "PIN / Manual") e não pode duplicar quando a pessoa também passou no facial
 * quase no mesmo instante.
 */
describe('MobileAuthService.getMeusEventos — entrada registrada na portaria', () => {
  const ID_USER = 20;
  const ID_APTO = 10;
  const ID_VISITANTE = 5;

  function build(visitanteOverrides: Record<string, any> = {}, acessosFacial: any[] = []) {
    const visitante = {
      id: ID_VISITANTE,
      nome: 'Vinicius Vilela Rufini',
      id_condominio: 1,
      id_apartamento: ID_APTO,
      is_prestador: 1,
      data_entrada: new Date('2026-09-04T13:08:00Z'),
      data_saida: null,
      ...visitanteOverrides,
    };

    const prisma: any = {
      isConnected: true,
      moradores: { findMany: jest.fn(async () => []) },
      apartamentos_Users: { findMany: jest.fn(async () => [{ id_apto: ID_APTO }]) },
      visitantes: { findMany: jest.fn(async () => [{ ...visitante }]) },
      acessos_Facial: { findMany: jest.fn(async () => acessosFacial) },
      condominios: { findMany: jest.fn(async () => [{ id: 1, nome: 'Edifício Demo' }]) },
    };

    const svc = new MobileAuthService(
      prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    return { svc };
  }

  it('mostra a entrada registrada manualmente pela portaria', async () => {
    const { svc } = build();

    const eventos = await svc.getMeusEventos(ID_USER, 15);

    const entrada = eventos.find((e: any) => e.evento === 'entrada');
    expect(entrada).toBeDefined();
    expect(entrada.nome).toBe('Vinicius Vilela Rufini');
    expect(entrada.tipo_pessoa).toBe('prestador');
    expect(entrada.tipo_dispositivo).toBe('pin');
    expect(entrada.condominio).toBe('Edifício Demo');
  });

  it('mostra também a saída registrada na portaria', async () => {
    const { svc } = build({ data_saida: new Date('2026-09-04T15:00:00Z') });

    const eventos = await svc.getMeusEventos(ID_USER, 15);

    expect(eventos.filter((e: any) => e.evento === 'saida')).toHaveLength(1);
    // Mais recente primeiro: a saída veio depois da entrada.
    expect(eventos[0].evento).toBe('saida');
  });

  it('não duplica quando o mesmo acesso já veio do terminal facial', async () => {
    const facial = [
      {
        id: 900,
        id_pessoa: ID_VISITANTE,
        id_condominio: 1,
        nome_pessoa: 'Vinicius Vilela Rufini',
        evento: 'entrada',
        tipo_pessoa: 'prestador',
        tipo_dispositivo: 'facial',
        confianca: 0.99,
        // 4s depois do data_entrada: mesmo acesso, gravado pelos dois caminhos.
        timestamp: new Date('2026-09-04T13:08:04Z'),
      },
    ];
    const { svc } = build({}, facial);

    const eventos = await svc.getMeusEventos(ID_USER, 15);

    const entradas = eventos.filter((e: any) => e.evento === 'entrada');
    expect(entradas).toHaveLength(1);
    expect(entradas[0].tipo_dispositivo).toBe('facial');
  });

  it('ignora registro antigo, fora da janela de 30 dias do feed', async () => {
    const antiga = new Date();
    antiga.setDate(antiga.getDate() - 45);
    const { svc } = build({ data_entrada: antiga });

    const eventos = await svc.getMeusEventos(ID_USER, 15);

    expect(eventos).toHaveLength(0);
  });
});
