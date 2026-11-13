import { BadRequestException } from '@nestjs/common';
import { VisitantesService } from './visitantes.service';

/**
 * Card ao vivo da portaria remota: ganchos no caminho antigo (Visitantes).
 * O CardAoVivoService é falso; aqui só importa QUEM chama O QUÊ e que falha
 * do card nunca muda a resposta.
 */
describe('VisitantesService — card ao vivo (caminho antigo)', () => {
  const APTO = 10;

  function build(visitorOverrides: Record<string, any> = {}, cardFalha = false) {
    const visitor = {
      id: 5,
      nome: 'João',
      doc_identificacao: '123',
      id_apartamento: APTO,
      id_condominio: 1,
      bloqueado: 0,
      is_prestador: 0,
      liberado: 0,
      auth_status: 'pendente',
      auth_solicitado_em: new Date(),
      foto_pessoa: null,
      user: null,
      apartamento: { bloco: 'A', apto: '101' },
      ...visitorOverrides,
    };
    const notifications = {
      sendPushNotification: jest.fn(async () => ({})),
      sendWhatsApp: jest.fn(async () => ({})),
    };
    const prisma: any = {
      isConnected: true,
      visitantes: {
        findUnique: jest.fn(async () => ({ ...visitor })),
        update: jest.fn(async ({ data }: any) => ({ ...visitor, ...data })),
        updateMany: jest.fn(async () => ({ count: 0 })),
        findMany: jest.fn(async () => []),
      },
      users: {
        findMany: jest.fn(async () => [
          { id: 20, fcm_token: 'token-valido-fcm-1', name: 'Maria', phone: null },
          { id: 21, fcm_token: 'token-valido-fcm-2', name: 'Pedro', phone: null },
        ]),
        findUnique: jest.fn(async () => null),
      },
      apartamentos_Users: {
        findFirst: jest.fn(async ({ where }: any) => (where.id_apto === APTO && [20, 21].includes(where.id_user) ? { id_apto: APTO } : null)),
        findMany: jest.fn(async () => [{ id_apto: APTO }]),
      },
    };
    const falha = () => Promise.reject(new Error('APNs fora'));
    const card = {
      abrir: jest.fn(cardFalha ? falha : async () => undefined),
      respondido: jest.fn(cardFalha ? falha : async () => undefined),
      entrou: jest.fn(cardFalha ? falha : async () => undefined),
      encerrar: jest.fn(cardFalha ? falha : async () => undefined),
    };
    const svc = new VisitantesService(
      prisma,
      notifications as any,
      {} as any,
      { syncVisitante: jest.fn(async () => ({ ok: true })) } as any,
      { registrar: jest.fn(async () => ({})) } as any,
      { assertCondominio: jest.fn(async () => undefined) } as any,
      { emitToCondominio: jest.fn() } as any,
      {} as any,
      card as any,
    );
    return { svc, prisma, notifications, card };
  }

  const porteiro = { id_condominio: 1, nome: 'Porteiro', sub: 99 } as any;
  const maria = { user: { id: 20 }, sub: 20, typeAccess: 'Morador' } as any;
  const pedro = { user: { id: 21 }, sub: 21, typeAccess: 'Morador' } as any;
  const esperar = () => new Promise((r) => setImmediate(r));

  it('solicitar abre o card para os moradores e não manda o push comum por cima', async () => {
    const { svc, card, notifications } = build({ auth_status: null });
    await svc.solicitarAutorizacao(5, porteiro);
    expect(card.abrir).toHaveBeenCalledWith(
      expect.objectContaining({ origem: 'visitante', id: 5, nome: 'João', isPrestador: false }),
      [20, 21],
    );
    expect(notifications.sendPushNotification).not.toHaveBeenCalled();
  });

  it('card que falha ao abrir cai no push comum', async () => {
    const { svc, notifications } = build({ auth_status: null }, true);
    await svc.solicitarAutorizacao(5, porteiro);
    expect(notifications.sendPushNotification).toHaveBeenCalledTimes(2);
  });

  it('autorizar avisa o card com quem respondeu', async () => {
    const { svc, card } = build();
    await svc.autorizar(5, maria);
    await esperar();
    expect(card.respondido).toHaveBeenCalledWith('visitante', 5, 'liberado', { idUser: 20, pelaPortaria: false });
    expect(card.entrou).not.toHaveBeenCalled();
  });

  it('autorizar e dar entrada leva o card a ENTROU', async () => {
    const { svc, card } = build();
    await svc.autorizar(5, maria, true);
    await esperar();
    expect(card.entrou).toHaveBeenCalledWith('visitante', 5);
  });

  it('negar depois de autorizado é recusado (primeira resposta vale)', async () => {
    const { svc, card } = build({ auth_status: 'autorizado', liberado: 1 });
    await expect(svc.negar(5, pedro)).rejects.toThrow(
      new BadRequestException('Esta solicitação já foi respondida ou resolvida pela portaria.'),
    );
    expect(card.respondido).not.toHaveBeenCalled();
  });

  it('autorizar depois de negado também é recusado', async () => {
    const { svc } = build({ auth_status: 'negado' });
    await expect(svc.autorizar(5, maria)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('autorizar fora dos 10 minutos é recusado', async () => {
    const { svc } = build({ auth_solicitado_em: new Date(Date.now() - 11 * 60_000) });
    await expect(svc.autorizar(5, maria)).rejects.toThrow('expirou');
  });

  it('check-in do porteiro com pedido pendente: liberado pela portaria e ENTROU', async () => {
    const { svc, card } = build();
    await svc.checkIn(5, porteiro);
    await esperar();
    expect(card.respondido).toHaveBeenCalledWith('visitante', 5, 'liberado', { idUser: null, pelaPortaria: true });
    expect(card.entrou).toHaveBeenCalledWith('visitante', 5);
  });

  it('check-in sem pedido pendente só leva a ENTROU', async () => {
    const { svc, card } = build({ auth_status: 'autorizado', liberado: 1 });
    await svc.checkIn(5, porteiro);
    await esperar();
    expect(card.respondido).not.toHaveBeenCalled();
    expect(card.entrou).toHaveBeenCalledWith('visitante', 5);
  });

  it('falha do card não muda a resposta do morador', async () => {
    const { svc } = build({}, true);
    await expect(svc.autorizar(5, maria)).resolves.toEqual({ ok: true });
    await esperar();
  });
});
