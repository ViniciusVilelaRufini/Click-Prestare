import { ForbiddenException } from '@nestjs/common';
import { AreasSociaisService } from './areas-sociais.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Confirmação de reserva (lembrete 30 min antes + cancelamento opt-in por
 * não-confirmação). A regra mais importante do recurso: só cancela quem
 * TEVE como confirmar — `lembrete_enviado_em` precisa estar preenchido, e só
 * é preenchido quando o push de fato saiu.
 */
describe('AreasSociaisService — confirmação de reserva', () => {
  const areaOptIn = { id: 30, id_condominio: 2, nome: 'Salão de Festas', exige_confirmacao: 1 };
  const areaSemOptIn = { id: 31, id_condominio: 2, nome: 'Churrasqueira', exige_confirmacao: 0 };

  function agendamento(overrides: Partial<any> = {}) {
    return {
      id: 1,
      id_user: 5,
      status: 'aprovado',
      data: new Date(2026, 5, 10),
      hora_de: new Date(1970, 0, 1, 10, 30, 0),
      hora_ate: new Date(1970, 0, 1, 12, 0, 0),
      lembrete_enviado_em: null,
      confirmada_em: null,
      user: { fcm_token: 'token-1' },
      area: { ...areaOptIn },
      ...overrides,
    };
  }

  /**
   * Mock enxuto que honra só as cláusulas que o service de fato usa nas
   * queries de tick — o suficiente para os testes pegarem se alguma delas
   * sumir do código (mesmo espírito do mock de manutencao.spec.ts).
   */
  function findManyHonrandoWhere(base: any[]) {
    return jest.fn(async ({ where }: any) => {
      return base.filter((ag) => {
        if (where.status && ag.status !== where.status) return false;
        if ('lembrete_enviado_em' in where) {
          const cond = where.lembrete_enviado_em;
          if (cond === null && ag.lembrete_enviado_em != null) return false;
          if (cond && typeof cond === 'object' && cond.not === null && ag.lembrete_enviado_em == null) return false;
        }
        if ('confirmada_em' in where && where.confirmada_em === null && ag.confirmada_em != null) return false;
        if (where.area?.exige_confirmacao !== undefined && ag.area?.exige_confirmacao !== where.area.exige_confirmacao) return false;
        return true;
      });
    });
  }

  function build(opts: { agendamentos?: any[] } = {}) {
    const prisma: any = {
      isConnected: true,
      areas_Sociais_Agendamentos: {
        findMany: findManyHonrandoWhere(opts.agendamentos ?? []),
        update: jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
        findUnique: jest.fn(async ({ where }: any) =>
          (opts.agendamentos ?? []).find((a) => a.id === where.id)
            ? {
                ...(opts.agendamentos ?? []).find((a) => a.id === where.id),
                area: { id_condominio: 2 },
              }
            : null,
        ),
      },
      // Ambos os moradores de teste (dono e "outro") pertencem ao mesmo
      // condomínio — a negação do teste de "outro morador" precisa vir da
      // checagem de posse dentro de `confirmarAgendamento`, não do tenant.
      apartamentos_Users: {
        findFirst: jest.fn(async ({ where }: any) => ([5, 6].includes(Number(where?.id_user)) ? { id_apto: 100 } : null)),
      },
      sindicos_Condominios: { findFirst: jest.fn(async () => null) },
      funcionarios: { findFirst: jest.fn(async () => null) },
    };
    const notifications: any = { sendPushNotification: jest.fn().mockResolvedValue('msg-id') };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const facial: any = { syncReservaArea: jest.fn().mockResolvedValue({}) };
    const tenant = new TenantAccessService(prisma);
    const svc = new AreasSociaisService(prisma, notifications, storage, facial, tenant);
    return { svc, prisma, notifications, facial };
  }

  const agora = new Date(2026, 5, 10, 10, 0, 0);
  const moradorDono: JwtPayload = { sub: 5, nome: 'Morador Dono', typeAccess: 'Morador' };
  const moradorOutro: JwtPayload = { sub: 6, nome: 'Outro Morador', typeAccess: 'Morador' };

  // ==========================================
  // Lembrete
  // ==========================================
  describe('enviarLembretesConfirmacao (via tick privado)', () => {
    it('reserva no início da janela (agora+25min) recebe o lembrete', async () => {
      const ag = agendamento({ hora_de: new Date(1970, 0, 1, 10, 25, 0) });
      const { svc, prisma, notifications } = build({ agendamentos: [ag] });
      await (svc as any).enviarLembretesConfirmacao(agora);
      expect(notifications.sendPushNotification).toHaveBeenCalledTimes(1);
      const [token, , , data] = notifications.sendPushNotification.mock.calls[0];
      expect(token).toBe('token-1');
      expect(data).toEqual({ type: 'confirmacao_reserva', id: '1' });
      expect(prisma.areas_Sociais_Agendamentos.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { lembrete_enviado_em: agora },
      });
    });

    it('reserva no fim da janela (agora+35min) também recebe o lembrete', async () => {
      const ag = agendamento({ hora_de: new Date(1970, 0, 1, 10, 35, 0) });
      const { svc, notifications } = build({ agendamentos: [ag] });
      await (svc as any).enviarLembretesConfirmacao(agora);
      expect(notifications.sendPushNotification).toHaveBeenCalledTimes(1);
    });

    it('reserva 1 min antes da janela NÃO recebe lembrete ainda', async () => {
      const ag = agendamento({ hora_de: new Date(1970, 0, 1, 10, 24, 0) });
      const { svc, notifications } = build({ agendamentos: [ag] });
      await (svc as any).enviarLembretesConfirmacao(agora);
      expect(notifications.sendPushNotification).not.toHaveBeenCalled();
    });

    it('reserva 1 min depois da janela NÃO recebe lembrete (perdeu o ciclo)', async () => {
      const ag = agendamento({ hora_de: new Date(1970, 0, 1, 10, 36, 0) });
      const { svc, notifications } = build({ agendamentos: [ag] });
      await (svc as any).enviarLembretesConfirmacao(agora);
      expect(notifications.sendPushNotification).not.toHaveBeenCalled();
    });

    it('reserva que já recebeu lembrete não é reconsiderada (a query já filtra, mock honra)', async () => {
      const ag = agendamento({ lembrete_enviado_em: new Date(2026, 5, 10, 9, 0, 0) });
      const { svc, notifications } = build({ agendamentos: [ag] });
      await (svc as any).enviarLembretesConfirmacao(agora);
      expect(notifications.sendPushNotification).not.toHaveBeenCalled();
    });

    it('sem fcm_token: não tenta push e não grava lembrete_enviado_em', async () => {
      const ag = agendamento({ user: { fcm_token: null } });
      const { svc, prisma, notifications } = build({ agendamentos: [ag] });
      await (svc as any).enviarLembretesConfirmacao(agora);
      expect(notifications.sendPushNotification).not.toHaveBeenCalled();
      expect(prisma.areas_Sociais_Agendamentos.update).not.toHaveBeenCalled();
    });

    it('push falhou (devolveu null): NÃO grava lembrete_enviado_em', async () => {
      const ag = agendamento();
      const { svc, prisma, notifications } = build({ agendamentos: [ag] });
      notifications.sendPushNotification.mockResolvedValueOnce(null);
      await (svc as any).enviarLembretesConfirmacao(agora);
      expect(notifications.sendPushNotification).toHaveBeenCalledTimes(1);
      expect(prisma.areas_Sociais_Agendamentos.update).not.toHaveBeenCalled();
    });

    it('push lançou exceção: não propaga e não grava lembrete_enviado_em', async () => {
      const ag = agendamento();
      const { svc, prisma, notifications } = build({ agendamentos: [ag] });
      notifications.sendPushNotification.mockRejectedValueOnce(new Error('fcm indisponível'));
      await expect((svc as any).enviarLembretesConfirmacao(agora)).resolves.toBeUndefined();
      expect(prisma.areas_Sociais_Agendamentos.update).not.toHaveBeenCalled();
    });
  });

  // ==========================================
  // Cancelamento
  // ==========================================
  describe('cancelarReservasNaoConfirmadas (via tick privado)', () => {
    // Reserva já começou (10:00), lembrete foi enviado, área é opt-in.
    function reservaVencidaCancelavel(overrides: Partial<any> = {}) {
      return agendamento({
        hora_de: new Date(1970, 0, 1, 9, 0, 0),
        hora_ate: new Date(1970, 0, 1, 11, 0, 0),
        lembrete_enviado_em: new Date(2026, 5, 10, 8, 30, 0),
        ...overrides,
      });
    }

    it('cancela reserva vencida, sem confirmação, em área opt-in, com lembrete enviado', async () => {
      const ag = reservaVencidaCancelavel();
      const { svc, prisma, facial, notifications } = build({ agendamentos: [ag] });
      await (svc as any).cancelarReservasNaoConfirmadas(agora);

      expect(prisma.areas_Sociais_Agendamentos.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: 'cancelado' },
      });
      expect(facial.syncReservaArea).toHaveBeenCalledWith(1);
      expect(notifications.sendPushNotification).toHaveBeenCalledTimes(1);
      const [token, title] = notifications.sendPushNotification.mock.calls[0];
      expect(token).toBe('token-1');
      expect(title).toBe('Reserva cancelada');
    });

    it('NÃO cancela em área que não é opt-in (exige_confirmacao = 0)', async () => {
      const ag = reservaVencidaCancelavel({ area: { ...areaSemOptIn } });
      const { svc, prisma, facial } = build({ agendamentos: [ag] });
      await (svc as any).cancelarReservasNaoConfirmadas(agora);
      expect(prisma.areas_Sociais_Agendamentos.update).not.toHaveBeenCalled();
      expect(facial.syncReservaArea).not.toHaveBeenCalled();
    });

    it('NÃO cancela reserva sem lembrete enviado (lembrete_enviado_em IS NULL) — regra crítica', async () => {
      const ag = reservaVencidaCancelavel({ lembrete_enviado_em: null });
      const { svc, prisma } = build({ agendamentos: [ag] });
      await (svc as any).cancelarReservasNaoConfirmadas(agora);
      expect(prisma.areas_Sociais_Agendamentos.update).not.toHaveBeenCalled();
    });

    it('NÃO cancela reserva já confirmada', async () => {
      const ag = reservaVencidaCancelavel({ confirmada_em: new Date(2026, 5, 10, 8, 40, 0) });
      const { svc, prisma } = build({ agendamentos: [ag] });
      await (svc as any).cancelarReservasNaoConfirmadas(agora);
      expect(prisma.areas_Sociais_Agendamentos.update).not.toHaveBeenCalled();
    });

    it('NÃO cancela reserva cujo início ainda não chegou', async () => {
      const ag = reservaVencidaCancelavel({ hora_de: new Date(1970, 0, 1, 10, 30, 0), hora_ate: new Date(1970, 0, 1, 12, 0, 0) });
      const { svc, prisma } = build({ agendamentos: [ag] });
      await (svc as any).cancelarReservasNaoConfirmadas(agora);
      expect(prisma.areas_Sociais_Agendamentos.update).not.toHaveBeenCalled();
    });

    it('falha de push não impede o cancelamento nem lança', async () => {
      const ag = reservaVencidaCancelavel();
      const { svc, prisma, notifications } = build({ agendamentos: [ag] });
      notifications.sendPushNotification.mockRejectedValueOnce(new Error('fcm indisponível'));
      await expect((svc as any).cancelarReservasNaoConfirmadas(agora)).resolves.toBeUndefined();
      expect(prisma.areas_Sociais_Agendamentos.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: 'cancelado' },
      });
    });
  });

  // ==========================================
  // Endpoint de confirmação
  // ==========================================
  describe('confirmarAgendamento', () => {
    it('dono confirma: grava confirmada_em no fuso do condomínio', async () => {
      const ag = agendamento();
      const { svc, prisma } = build({ agendamentos: [ag] });
      const resultado = await svc.confirmarAgendamento(1, 5, 'Morador', moradorDono);
      expect(resultado).toEqual({ success: true });
      expect(prisma.areas_Sociais_Agendamentos.update).toHaveBeenCalledTimes(1);
      const [[call]] = prisma.areas_Sociais_Agendamentos.update.mock.calls;
      expect(call.where).toEqual({ id: 1 });
      expect(call.data.confirmada_em).toBeInstanceOf(Date);
    });

    it('nega confirmação de outro morador (não é o dono)', async () => {
      const ag = agendamento();
      const { svc, prisma } = build({ agendamentos: [ag] });
      await expect(svc.confirmarAgendamento(1, 6, 'Morador', moradorOutro)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.areas_Sociais_Agendamentos.update).not.toHaveBeenCalled();
    });

    it('confirmar duas vezes é idempotente: não regrava confirmada_em na segunda chamada', async () => {
      const jaConfirmada = new Date(2026, 5, 10, 9, 45, 0);
      const ag = agendamento({ confirmada_em: jaConfirmada });
      const { svc, prisma } = build({ agendamentos: [ag] });
      const resultado = await svc.confirmarAgendamento(1, 5, 'Morador', moradorDono);
      expect(resultado).toEqual({ success: true });
      expect(prisma.areas_Sociais_Agendamentos.update).not.toHaveBeenCalled();
    });
  });
});
