import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { DeliveryService } from './delivery.service';

describe('DeliveryService', () => {
  const morador = { sub: 10, typeAccess: 'Morador' } as any;
  const porteiro = { sub: 20, id_condominio: 1, nome: 'Portaria' } as any;

  function montar(opcoes: {
    apartamentoDoMorador?: boolean;
    entregadorBloqueado?: boolean;
    entregadorCondominio?: number;
    falhaEvento?: boolean;
  } = {}) {
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
        findMany: jest.fn(async ({ include }: any) => {
          const entregador = {
            id: 7,
            nome: 'Motoboy Teste',
            telefone: '11999999999',
            plataforma: 'Entrega Rápida',
            documento: '12345678900',
            status: 'BLOQUEADO',
            motivo_bloqueio: 'Ocorrência interna',
            foto: 'https://interno/foto.jpg',
          };
          const selecionado = include?.entregador?.select;
          return [{
            id: 91,
            id_condominio: 1,
            id_apartamento: 101,
            id_morador_user: 10,
            status: 'CHEGOU',
            entregador: selecionado
              ? Object.fromEntries(Object.keys(selecionado).map((campo) => [campo, entregador[campo as keyof typeof entregador]]))
              : entregador,
            eventos: include?.eventos?.select
              ? [{ status_novo: 'CHEGOU', mensagem: 'Chegou', created_at: new Date() }]
              : [{ id: 88, id_atendimento: 91, id_usuario_autor: 20, autor_nome: 'Portaria', status_novo: 'CHEGOU', mensagem: 'Chegou', created_at: new Date() }],
          }];
        }),
      },
      deliveryEntregadores: {
        findUnique: jest.fn(async () => ({ id: 7, id_condominio: opcoes.entregadorCondominio ?? 1, status: opcoes.entregadorBloqueado ? 'BLOQUEADO' : 'ATIVO' })),
      },
      deliveryEventos: {
        create: jest.fn(async ({ data }: any) => {
          if (opcoes.falhaEvento) throw new Error('evento indisponível');
          eventos.push(data);
          return data;
        }),
      },
    };
    prisma.$transaction = jest.fn(async (callback: (tx: any) => Promise<any>) => {
      const antes = atendimentos.map((atendimento) => ({ ...atendimento }));
      try {
        return await callback(prisma);
      } catch (erro) {
        atendimentos.splice(0, atendimentos.length, ...antes);
        throw erro;
      }
    });
    const notifications: any = { sendPushNotification: jest.fn(async () => undefined) };
    const tenant: any = { assertCondominio: jest.fn(async () => undefined), assertEntidade: jest.fn(async () => undefined) };
    return { service: new DeliveryService(prisma, notifications, tenant), atendimentos, eventos, notifications, prisma };
  }

  it('recusa aviso de morador para apartamento sem vínculo', async () => {
    const { service } = montar({ apartamentoDoMorador: false });

    await expect(service.criarAviso({ id_condominio: 1, id_apartamento: 101 }, morador))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('preserva nome e telefone opcionais do entregador informados no aviso', async () => {
    const { service, atendimentos } = montar();

    await service.criarAviso({
      id_condominio: 1,
      id_apartamento: 101,
      nome_entregador: 'Motoboy Teste',
      telefone_entregador: '11999999999',
    } as any, morador);

    expect(atendimentos[0]).toMatchObject({
      nome_entregador: 'Motoboy Teste',
      telefone_entregador: '11999999999',
    });
  });

  it('oculta documento, bloqueio e motivos do entregador na listagem do morador', async () => {
    const { service } = montar();

    const [atendimento] = await service.listarAtendimentos(1, undefined, morador);

    expect(atendimento.entregador).toEqual({
      nome: 'Motoboy Teste',
      telefone: '11999999999',
      plataforma: 'Entrega Rápida',
    });
    expect(atendimento.eventos).toEqual([
      expect.objectContaining({ status_novo: 'CHEGOU', mensagem: 'Chegou' }),
    ]);
    expect(atendimento.eventos[0]).not.toHaveProperty('id');
    expect(atendimento.eventos[0]).not.toHaveProperty('id_usuario_autor');
    expect(atendimento.eventos[0]).not.toHaveProperty('autor_nome');
    expect(atendimento.entregador).not.toHaveProperty('id');
    expect(atendimento.entregador).not.toHaveProperty('documento');
    expect(atendimento.entregador).not.toHaveProperty('status');
    expect(atendimento.entregador).not.toHaveProperty('motivo_bloqueio');
    expect(atendimento.entregador).not.toHaveProperty('foto');
  });

  it('mantém dados completos do entregador na listagem operacional da portaria', async () => {
    const { service } = montar();

    const [atendimento] = await service.listarAtendimentos(1, undefined, porteiro);

    expect(atendimento.entregador).toMatchObject({
      documento: '12345678900',
      status: 'BLOQUEADO',
      motivo_bloqueio: 'Ocorrência interna',
    });
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

  it('não associa entregador de outro condomínio ao atendimento', async () => {
    const { service } = montar({ entregadorCondominio: 2 });
    const aviso = await service.criarAviso({ id_condominio: 1, id_apartamento: 101 }, morador);

    await expect(service.atualizarStatus(aviso.id, { status: 'CHEGOU', id_entregador: 7 }, porteiro))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('envia a atualização somente ao token do morador que criou o aviso', async () => {
    const { service, notifications, prisma } = montar();
    prisma.apartamentos_Users.findFirst.mockImplementation(async ({ where }: any) => {
      if (where.id_user === 10) return { id: 1 };
      if (where.id_user === undefined && where.id_apto === 101) return { id: 2, user: { fcm_token: 'token-outro-morador' } };
      return null;
    });
    const aviso = await service.criarAviso({ id_condominio: 1, id_apartamento: 101 }, morador);
    prisma.apartamentos_Users.findFirst.mockImplementation(async ({ where }: any) => {
      if (where.id_user === 10 && where.id_apto === 101) return { id: 1, user: { fcm_token: 'token-solicitante' } };
      return { id: 2, user: { fcm_token: 'token-outro-morador' } };
    });

    await service.atualizarStatus(aviso.id, { status: 'CHEGOU' }, porteiro);

    expect(notifications.sendPushNotification).toHaveBeenCalledWith(
      'token-solicitante', expect.any(String), expect.any(String), expect.any(Object),
    );
  });

  it('desfaz a alteração de status quando o evento de auditoria falha', async () => {
    const { service, atendimentos, prisma } = montar();
    const aviso = await service.criarAviso({ id_condominio: 1, id_apartamento: 101 }, morador);
    prisma.deliveryEventos.create.mockRejectedValueOnce(new Error('evento indisponível'));

    await expect(service.atualizarStatus(aviso.id, { status: 'CHEGOU' }, porteiro))
      .rejects.toThrow('evento indisponível');

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(atendimentos[0].status).toBe('AGENDADA');
  });
});
