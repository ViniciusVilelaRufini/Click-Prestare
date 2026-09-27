import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { DeliveryService } from './delivery.service';

describe('DeliveryService', () => {
  const morador = { sub: 10, typeAccess: 'Morador' } as any;
  const porteiro = { sub: 20, id_condominio: 1, nome: 'Portaria' } as any;

  function montar(opcoes: { apartamentoDoMorador?: boolean; entregadorBloqueado?: boolean } = {}) {
    let proximoId = 1;
    const atendimentos: any[] = [];
    const eventos: any[] = [];
    const prisma: any = {
      isConnected: true,
      apartamentos_Users: {
        findFirst: jest.fn(async () => (opcoes.apartamentoDoMorador === false ? null : { id: 1, user: { fcm_token: 'token-morador' } })),
      },
      apartamentos: {
        findUnique: jest.fn(async () => ({ id: 101, id_condominio: 1 })),
      },
      deliveryAtendimentos: {
        create: jest.fn(async ({ data }: any) => {
          const atendimento = { id: proximoId++, ...data, created_at: new Date() };
          atendimentos.push(atendimento);
          return atendimento;
        }),
        findUnique: jest.fn(async ({ where }: any) => atendimentos.find((a) => a.id === where.id) ?? null),
        update: jest.fn(async ({ where, data }: any) => {
          const atendimento = atendimentos.find((a) => a.id === where.id);
          Object.assign(atendimento, data);
          return atendimento;
        }),
      },
      deliveryEntregadores: {
        findUnique: jest.fn(async () => ({ id: 7, id_condominio: 1, status: opcoes.entregadorBloqueado ? 'BLOQUEADO' : 'ATIVO' })),
      },
      deliveryEventos: {
        create: jest.fn(async ({ data }: any) => {
          eventos.push(data);
          return data;
        }),
      },
    };
    const notifications: any = { sendPushNotification: jest.fn(async () => undefined) };
    const tenant: any = { assertCondominio: jest.fn(async () => undefined), assertEntidade: jest.fn(async () => undefined) };
    return { service: new DeliveryService(prisma, notifications, tenant), atendimentos, eventos, notifications };
  }

  it('recusa aviso de morador para apartamento sem vínculo', async () => {
    const { service } = montar({ apartamentoDoMorador: false });

    await expect(service.criarAviso({ id_condominio: 1, id_apartamento: 101 }, morador))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('conduz o atendimento de AGENDADA até CONCLUIDA e registra cada transição', async () => {
    const { service, atendimentos, eventos, notifications } = montar();
    const aviso = await service.criarAviso({ id_condominio: 1, id_apartamento: 101 }, morador);

    await service.atualizarStatus(aviso.id, { status: 'CHEGOU', id_entregador: 7 }, porteiro);
    await service.atualizarStatus(aviso.id, { status: 'AUTORIZADA' }, porteiro);
    await service.atualizarStatus(aviso.id, { status: 'CONCLUIDA' }, porteiro);

    expect(atendimentos[0]).toMatchObject({ status: 'CONCLUIDA', chegou_em: expect.any(Date), autorizado_em: expect.any(Date), concluido_em: expect.any(Date) });
    expect(eventos.map((evento) => evento.status_novo)).toEqual(['AGENDADA', 'CHEGOU', 'AUTORIZADA', 'CONCLUIDA']);
    expect(notifications.sendPushNotification).toHaveBeenCalledTimes(3);
  });

  it('recusa transição para RECUSADA sem motivo', async () => {
    const { service } = montar();
    const aviso = await service.criarAviso({ id_condominio: 1, id_apartamento: 101 }, morador);
    await service.atualizarStatus(aviso.id, { status: 'CHEGOU' }, porteiro);

    await expect(service.atualizarStatus(aviso.id, { status: 'RECUSADA' }, porteiro))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('impede autorização quando o entregador associado está bloqueado', async () => {
    const { service } = montar({ entregadorBloqueado: true });
    const aviso = await service.criarAviso({ id_condominio: 1, id_apartamento: 101 }, morador);
    await service.atualizarStatus(aviso.id, { status: 'CHEGOU', id_entregador: 7 }, porteiro);

    await expect(service.atualizarStatus(aviso.id, { status: 'AUTORIZADA' }, porteiro))
      .rejects.toBeInstanceOf(ConflictException);
  });
});
