import { MobileAuthService } from './mobile-auth.service';

/**
 * O app conta como "nova" a notificação com `timestamp` depois da última
 * visita à central (controller_notificacoes.contarNaoLidas).
 *
 * F6: a conta a vencer usava `timestamp = data_vencimento`, no futuro: o selo
 * nunca zerava até o vencimento passar. Agora o timestamp é quando a conta
 * apareceu no aviso (emissão, ou a entrada na janela de 7 dias), nunca no
 * futuro, e o vencimento vem em `vencimento`.
 *
 * F18: "Você entrou/saiu" e "Reserva registrada" são ações do próprio
 * usuário; o item ganha `proprio: true` para o app não contar no selo.
 */
describe('MobileAuthService — getNotificacoes() e o selo do sino', () => {
  const AGORA = new Date('2026-11-25T15:00:00Z');
  beforeEach(() => jest.useFakeTimers({ now: AGORA, doNotFake: ['nextTick', 'setImmediate'] }));
  afterEach(() => jest.useRealTimers());

  function build(opts: { contas?: any[]; reservas?: any[]; eventos?: any[] } = {}) {
    const prisma: any = {
      isConnected: true,
      users: {
        findUnique: jest.fn(async () => ({
          notif_encomendas: 0,
          notif_comunicados: 0,
          notif_ocorrencias: 0,
          notif_visitantes: 1,
        })),
      },
      moradores: { findMany: jest.fn(async () => []) },
      apartamentos_Users: { findMany: jest.fn(async () => []) },
      encomendas: { findMany: jest.fn(async () => []) },
      visitantes: { findMany: jest.fn(async () => []) },
      visitas: { findMany: jest.fn(async () => []) },
      financeiro: { findMany: jest.fn(async () => opts.contas ?? []) },
      areas_Sociais_Agendamentos: { findMany: jest.fn(async () => opts.reservas ?? []) },
    };
    const svc = new MobileAuthService(
      prisma, {} as any, {} as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    jest.spyOn(svc as any, 'getMeusEventos').mockResolvedValue(opts.eventos ?? []);
    return svc;
  }

  describe('F6 — conta a vencer', () => {
    it('emitida há 2 dias, vence em 3: timestamp é a emissão; vencimento separado', async () => {
      const created_at = new Date('2026-11-23T12:00:00Z');
      const svc = build({
        contas: [{ id: 1, nome: 'Condomínio', valor: 500, pago: 0, data_vencimento: new Date('2026-11-28T00:00:00Z'), created_at }],
      });
      const itens: any[] = await svc.getNotificacoes(9);
      const item = itens.find((i) => i.id === 'financeiro-1');
      expect(item.titulo).toBe('Conta a vencer');
      expect(new Date(item.timestamp).getTime()).toBe(created_at.getTime());
      expect(item.vencimento).toBe('2026-11-28');
    });

    it('emitida há meses: timestamp é a entrada na janela de 7 dias (nunca no futuro)', async () => {
      const svc = build({
        contas: [{
          id: 2, nome: 'Fundo', valor: 50, pago: 0,
          data_vencimento: new Date('2026-11-30T00:00:00Z'),
          created_at: new Date('2026-08-01T12:00:00Z'),
        }],
      });
      const itens: any[] = await svc.getNotificacoes(9);
      const item = itens.find((i) => i.id === 'financeiro-2');
      const ts = new Date(item.timestamp).getTime();
      expect(ts).toBeLessThanOrEqual(AGORA.getTime());
      expect(ts).toBe(new Date('2026-11-23T00:00:00Z').getTime());
    });

    it('nenhum item do feed tem timestamp no futuro', async () => {
      const svc = build({
        contas: [{
          id: 3, nome: 'Extra', valor: 10, pago: 0,
          data_vencimento: new Date('2026-11-26T00:00:00Z'),
          created_at: new Date('2026-11-25T20:00:00Z'), // relógio do banco à frente
        }],
      });
      const itens: any[] = await svc.getNotificacoes(9);
      for (const i of itens) expect(new Date(i.timestamp).getTime()).toBeLessThanOrEqual(AGORA.getTime());
    });
  });

  describe('F18 — ações do próprio usuário', () => {
    it('"Você entrou" vem com proprio: true; a entrada de outra pessoa, não', async () => {
      const svc = build({
        eventos: [
          { id: 'a1', evento: 'entrada', categoria: 'voce', nome: 'Ana', timestamp: new Date('2026-11-25T14:00:00Z') },
          { id: 'a2', evento: 'entrada', categoria: 'visitante', nome: 'João', timestamp: new Date('2026-11-25T14:10:00Z') },
        ],
      });
      const itens: any[] = await svc.getNotificacoes(9);
      expect(itens.find((i) => i.id === 'acesso-a1')).toMatchObject({ proprio: true, categoria: 'voce' });
      expect(itens.find((i) => i.id === 'acesso-a2').proprio).toBeFalsy();
      expect(itens.find((i) => i.id === 'acesso-a2').categoria).toBeUndefined();
    });

    it('reserva pendente é própria ("aguardando aprovação"); aprovada/cancelada por terceiros, não, e cada estado tem seu título', async () => {
      const svc = build({
        reservas: [
          { id: 1, status: 'pendente', data: new Date('2026-11-30'), updated_at: new Date('2026-11-25T10:00:00Z'), area: { nome: 'Salão' } },
          { id: 2, status: 'aprovado', data: new Date('2026-11-30'), updated_at: new Date('2026-11-25T11:00:00Z'), area: { nome: 'Salão' } },
          { id: 3, status: 'cancelado', data: new Date('2026-11-30'), updated_at: new Date('2026-11-25T12:00:00Z'), area: { nome: 'Salão' } },
          { id: 4, status: 'concluido', data: new Date('2026-11-30'), updated_at: new Date('2026-11-25T13:00:00Z'), area: { nome: 'Salão' } },
        ],
      });
      const itens: any[] = await svc.getNotificacoes(9);
      const titulo = (id: string) => itens.find((i) => i.id === id).titulo;
      expect(titulo('reserva-1')).toBe('Reserva aguardando aprovação');
      expect(titulo('reserva-2')).toBe('Reserva aprovada');
      expect(titulo('reserva-3')).toBe('Reserva cancelada');
      expect(titulo('reserva-4')).toBe('Reserva atualizada');
      expect(itens.find((i) => i.id === 'reserva-3').proprio).toBeFalsy();
      expect(itens.find((i) => i.id === 'reserva-1')).toMatchObject({ proprio: true, categoria: 'voce' });
      expect(itens.find((i) => i.id === 'reserva-2').proprio).toBeFalsy();
    });
  });
});
