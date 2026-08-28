import { ConflictException } from '@nestjs/common';
import { AreasSociaisService } from './areas-sociais.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Cobre o buraco que a entrega anterior deixou: marcar manutenção sobre uma
 * janela que já tem reservas ativas não avisava ninguém e, em área com
 * facial, a catraca continuava abrindo. Agora `insertManutencao`/
 * `updateManutencao` detectam a colisão e exigem confirmação explícita antes
 * de cancelar qualquer coisa.
 */
describe('AreasSociaisService — manutenção cancela reservas atingidas', () => {
  const area = {
    id: 30,
    id_condominio: 2,
    nome: 'Churrasqueira Gourmet',
    precisa_autorizacao: 0,
    imagem: '',
    capacidade: 10,
    precisa_agendar: 1,
    precisa_pagamento: 0,
    horarios: '[]',
  };

  const sindicoCond2: JwtPayload = { sub: 9, nome: 'Síndico Z', typeAccess: 'Sindico', is_sindico: 1 } as any;

  function agendamentoDb(overrides: Partial<any> = {}) {
    return {
      id: 1,
      status: 'aprovado',
      apartamento: { bloco: 'A', apto: '101' },
      user: { fcm_token: 'token-1' },
      data: new Date(2026, 5, 10),
      hora_de: new Date(1970, 0, 1, 10, 0, 0),
      hora_ate: new Date(1970, 0, 1, 14, 0, 0),
      ...overrides,
    };
  }

  function build(opts: { agendamentos?: any[] } = {}) {
    const prisma: any = {
      isConnected: true,
      areas_Sociais: {
        findUnique: jest.fn(async ({ where }: any) => (where.id === 30 ? { ...area } : null)),
      },
      areas_Sociais_Manutencoes: {
        create: jest.fn(async () => ({ id: 900 })),
        update: jest.fn(async () => ({ id: 900 })),
        findUnique: jest.fn(async ({ where }: any) =>
          where.id === 900 ? { id: 900, id_area_social: 30, area: { id_condominio: 2, nome: area.nome } } : null,
        ),
      },
      areas_Sociais_Agendamentos: {
        findMany: jest.fn(async () => opts.agendamentos ?? []),
        update: jest.fn(async ({ where }: any) => ({ id: where.id })),
      },
      sindicos_Condominios: {
        findFirst: jest.fn(async () => ({ id: 1 })),
      },
    };
    const notifications: any = { sendPushNotification: jest.fn().mockResolvedValue('msg-id') };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const facial: any = { syncReservaArea: jest.fn().mockResolvedValue({}) };
    const tenant = new TenantAccessService(prisma);
    const svc = new AreasSociaisService(prisma, notifications, storage, facial, tenant);
    return { svc, prisma, notifications, facial };
  }

  const manutencaoBase = {
    id_area_social: 30,
    descricao: 'Pintura geral',
    data_inicio: '10/06/2026',
    hora_inicio: '09:00',
    data_termino: '10/06/2026',
    hora_termino: '18:00',
  };

  describe('insertManutencao', () => {
    it('sem conflito: grava direto', async () => {
      const { svc, prisma } = build({ agendamentos: [] });
      const resultado = await svc.insertManutencao(manutencaoBase, sindicoCond2);
      expect(resultado).toEqual({ success: true });
      expect(prisma.areas_Sociais_Manutencoes.create).toHaveBeenCalledTimes(1);
    });

    it('com conflito e sem confirmar_cancelamentos: não grava nada e devolve 409 com a lista', async () => {
      const { svc, prisma, notifications, facial } = build({
        agendamentos: [agendamentoDb({ id: 1 })],
      });

      let erro: any;
      try {
        await svc.insertManutencao(manutencaoBase, sindicoCond2);
      } catch (e) {
        erro = e;
      }

      expect(erro).toBeInstanceOf(ConflictException);
      expect(erro.getResponse()).toEqual({
        conflitos: [{ id: 1, data: '10/06/2026', hora_de: '10:00', hora_ate: '14:00', bloco: 'A', apto: '101' }],
        total: 1,
      });
      expect(prisma.areas_Sociais_Manutencoes.create).not.toHaveBeenCalled();
      expect(prisma.areas_Sociais_Agendamentos.update).not.toHaveBeenCalled();
      expect(facial.syncReservaArea).not.toHaveBeenCalled();
      expect(notifications.sendPushNotification).not.toHaveBeenCalled();
    });

    it('com conflito e confirmar_cancelamentos: grava, cancela só os atingidos e dispara push/facial', async () => {
      const forasDaJanela = agendamentoDb({ id: 2, hora_de: new Date(1970, 0, 1, 20, 0, 0), hora_ate: new Date(1970, 0, 1, 22, 0, 0) });
      const recusado = agendamentoDb({ id: 3, status: 'recusado' });
      const atingido = agendamentoDb({ id: 1 });

      const { svc, prisma, notifications, facial } = build({
        // O filtro `status: { in: ['pendente','aprovado'] } ` já tira o
        // recusado no banco de verdade; aqui simulamos só o que o findMany
        // devolveria (mock não reaplica o where).
        agendamentos: [atingido, forasDaJanela],
      });

      const resultado = await svc.insertManutencao({ ...manutencaoBase, confirmar_cancelamentos: true }, sindicoCond2);

      expect(resultado).toEqual({ success: true });
      expect(prisma.areas_Sociais_Manutencoes.create).toHaveBeenCalledTimes(1);

      // Só o agendamento 1 (dentro da janela 09:00-18:00) foi cancelado.
      expect(prisma.areas_Sociais_Agendamentos.update).toHaveBeenCalledTimes(1);
      expect(prisma.areas_Sociais_Agendamentos.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: 'cancelado' },
      });

      expect(facial.syncReservaArea).toHaveBeenCalledTimes(1);
      expect(facial.syncReservaArea).toHaveBeenCalledWith(1);

      expect(notifications.sendPushNotification).toHaveBeenCalledTimes(1);
      const [token, title] = notifications.sendPushNotification.mock.calls[0];
      expect(token).toBe('token-1');
      expect(title).toBe('Reserva cancelada');

      // agendamento fora da janela nunca aparece nas chamadas acima.
      expect(recusado).toBeDefined();
    });

    it('falha de push não impede o cancelamento nem lança', async () => {
      const { svc, prisma, notifications } = build({ agendamentos: [agendamentoDb({ id: 1 })] });
      notifications.sendPushNotification.mockRejectedValueOnce(new Error('fcm indisponível'));

      const resultado = await svc.insertManutencao({ ...manutencaoBase, confirmar_cancelamentos: true }, sindicoCond2);

      expect(resultado).toEqual({ success: true });
      expect(prisma.areas_Sociais_Agendamentos.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: 'cancelado' },
      });
    });
  });

  describe('updateManutencao', () => {
    const updateBase = { id: 900, ...manutencaoBase };

    it('com conflito e sem confirmar_cancelamentos: não grava e devolve 409', async () => {
      const { svc, prisma } = build({ agendamentos: [agendamentoDb({ id: 1 })] });

      await expect(svc.updateManutencao(updateBase, sindicoCond2)).rejects.toThrow(ConflictException);
      expect(prisma.areas_Sociais_Manutencoes.update).not.toHaveBeenCalled();
    });

    it('com confirmar_cancelamentos: grava e cancela os atingidos', async () => {
      const { svc, prisma, facial } = build({ agendamentos: [agendamentoDb({ id: 1 })] });

      const resultado = await svc.updateManutencao({ ...updateBase, confirmar_cancelamentos: true }, sindicoCond2);

      expect(resultado).toEqual({ success: true });
      expect(prisma.areas_Sociais_Manutencoes.update).toHaveBeenCalledTimes(1);
      expect(prisma.areas_Sociais_Agendamentos.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: 'cancelado' },
      });
      expect(facial.syncReservaArea).toHaveBeenCalledWith(1);
    });
  });
});
