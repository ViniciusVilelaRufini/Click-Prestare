import { ConflictException } from '@nestjs/common';
import { AreasSociaisService } from './areas-sociais.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Exclusões que apagavam histórico ou acesso sem ninguém saber:
 *
 * 1. Excluir o espaço levava em cascata as reservas futuras (sem cancelar, sem
 *    push, sem tirar o morador do terminal) e o terminal da área ficava com
 *    id_area_social = NULL — deixava de ser "de reserva" e o próximo
 *    syncMorador enrolava qualquer morador nele. Agora: 409 enquanto houver
 *    reserva ativa por acontecer ou terminal vinculado.
 * 2. "Excluir" no app (removeAgendamento) apagava de verdade uma reserva já
 *    usada: ela saía do limite mensal e o morador reservava de novo. Agora:
 *    409 para reserva aprovada que já terminou; e a do próprio morador vira
 *    'cancelado' (fica no histórico do console) em vez de DELETE.
 */
const AGORA = new Date('2026-06-10T15:00:00.000Z'); // 12:00 em Brasília

const sindico: JwtPayload = { sub: 1, nome: 'Síndico', id_condominio: 2, typeAccess: 'Sindico' };
const morador: JwtPayload = { sub: 5, nome: 'Morador', typeAccess: 'Morador' };

function build(opts: { agendamentos?: any[]; devices?: number; reserva?: any } = {}) {
  const prisma: any = {
    isConnected: true,
    areas_Sociais: {
      findUnique: jest.fn(async () => ({ id: 30, id_condominio: 2, nome: 'Salão' })),
      delete: jest.fn(async () => ({})),
    },
    areas_Sociais_Agendamentos: {
      findMany: jest.fn(async () => opts.agendamentos ?? []),
      findUnique: jest.fn(async () => (opts.reserva ? { ...opts.reserva } : null)),
      update: jest.fn(async ({ data }: any) => ({ ...opts.reserva, ...data })),
      updateMany: jest.fn(async () => ({ count: 1 })),
      delete: jest.fn(async () => ({})),
    },
    facial_Devices: { count: jest.fn(async () => opts.devices ?? 0) },
    apartamentos_Users: { findFirst: jest.fn(async () => ({ id_apto: 100 })), findMany: jest.fn(async () => []) },
    sindicos_Condominios: { findFirst: jest.fn(async () => ({ id: 1 })) },
    funcionarios: { findFirst: jest.fn(async () => null) },
  };
  const notifications: any = { sendPushNotification: jest.fn() };
  const storage: any = { isDataUrl: () => false };
  const facial: any = { syncReservaArea: jest.fn().mockResolvedValue({}) };
  const tenant = new TenantAccessService(prisma);
  jest.spyOn(tenant, 'assertEntidade').mockResolvedValue(undefined as any);
  jest.spyOn(tenant, 'assertPermissaoFuncionario').mockResolvedValue(undefined as any);
  const svc = new AreasSociaisService(prisma, notifications, storage, facial, tenant);
  return { svc, prisma, facial };
}

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const hora = (h: number, m = 0) => new Date(1970, 0, 1, h, m, 0);

describe('AreasSociaisService — excluir espaço e reserva sem apagar o que importa', () => {
  beforeAll(() => jest.useFakeTimers({ advanceTimers: true }).setSystemTime(AGORA));
  afterAll(() => jest.useRealTimers());

  describe('remove (espaço)', () => {
    it('com reserva aprovada futura: 409 e nada é apagado', async () => {
      const { svc, prisma } = build({
        agendamentos: [{ id: 1, status: 'aprovado', data: dia('2026-06-20'), hora_de: hora(18), hora_ate: hora(22) }],
      });
      const erro = await svc.remove(30, sindico).catch((e) => e);
      expect(erro).toBeInstanceOf(ConflictException);
      expect(erro.message).toMatch(/reserva/i);
      expect(prisma.areas_Sociais.delete).not.toHaveBeenCalled();
    });

    it('reserva de hoje que ainda não terminou também segura a exclusão', async () => {
      const { svc, prisma } = build({
        agendamentos: [{ id: 2, status: 'pendente', data: dia('2026-06-10'), hora_de: hora(20), hora_ate: hora(0) }],
      });
      await expect(svc.remove(30, sindico)).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.areas_Sociais.delete).not.toHaveBeenCalled();
    });

    it('só reserva de hoje que já terminou: não segura', async () => {
      const { svc, prisma } = build({
        agendamentos: [{ id: 3, status: 'aprovado', data: dia('2026-06-10'), hora_de: hora(8), hora_ate: hora(10) }],
      });
      await svc.remove(30, sindico);
      expect(prisma.areas_Sociais.delete).toHaveBeenCalled();
    });

    it('lista na mensagem as próximas reservas (até 3) para o síndico saber quais cancelar', async () => {
      const { svc } = build({
        agendamentos: [
          { id: 1, status: 'aprovado', data: dia('2026-06-20'), hora_de: hora(18), hora_ate: hora(22) },
          { id: 2, status: 'pendente', data: dia('2026-06-21'), hora_de: hora(10), hora_ate: hora(12) },
          { id: 3, status: 'aprovado', data: dia('2026-06-22'), hora_de: hora(14), hora_ate: hora(16) },
          { id: 4, status: 'aprovado', data: dia('2026-06-23'), hora_de: hora(9), hora_ate: hora(11) },
        ],
      });
      const erro = await svc.remove(30, sindico).catch((e) => e);
      expect(erro.message).toBe(
        'Este espaço tem 4 reservas ativas por acontecer (20/06/2026 às 18:00, 21/06/2026 às 10:00, 22/06/2026 às 14:00 e outras). ' +
          'Cancele-as antes de excluir o espaço.',
      );
    });

    it('com terminal facial ligado (mesmo desativado): 409 dizendo onde agir e a consequência', async () => {
      const { svc, prisma } = build({
        devices: 1,
        agendamentos: [{ id: 1, status: 'aprovado', data: dia('2026-06-20'), hora_de: hora(18), hora_ate: hora(22) }],
      });
      const erro = await svc.remove(30, sindico).catch((e) => e);
      expect(erro).toBeInstanceOf(ConflictException);
      // O terminal é conferido antes das reservas.
      expect(erro.message).toMatch(/^Este espaço tem um terminal facial ligado a ele\. Em Terminais faciais/);
      expect(erro.message).toMatch(/desativado também conta/);
      expect(erro.message).toMatch(/liberar todos os moradores/);
      expect(prisma.facial_Devices.count).toHaveBeenCalledWith({ where: { id_area_social: 30 } });
      expect(prisma.areas_Sociais.delete).not.toHaveBeenCalled();
    });

    it('sem reserva ativa nem terminal: exclui', async () => {
      const { svc, prisma } = build();
      await svc.remove(30, sindico);
      expect(prisma.areas_Sociais.delete).toHaveBeenCalledWith({ where: { id: 30 } });
    });
  });

  describe('removeAgendamento (reserva)', () => {
    const base = { id: 500, id_user: 5, id_area_social: 30, area: { id_condominio: 2 } };

    it('reserva aprovada que já terminou: 409 e a reserva fica', async () => {
      const { svc, prisma } = build({
        reserva: { ...base, status: 'aprovado', data: dia('2026-06-10'), hora_de: hora(8), hora_ate: hora(10) },
      });
      const erro = await svc.removeAgendamento(500, 5, 'Morador', morador).catch((e) => e);
      expect(erro).toBeInstanceOf(ConflictException);
      expect(erro.message).toBe('Esta reserva já aconteceu.');
      expect(prisma.areas_Sociais_Agendamentos.delete).not.toHaveBeenCalled();
      expect(prisma.areas_Sociais_Agendamentos.update).not.toHaveBeenCalled();
      expect(prisma.areas_Sociais_Agendamentos.updateMany).not.toHaveBeenCalled();
    });

    it('o mesmo vale para o síndico', async () => {
      const { svc, prisma } = build({
        reserva: { ...base, status: 'aprovado', data: dia('2026-06-09'), hora_de: hora(20), hora_ate: hora(0) },
      });
      await expect(svc.removeAgendamento(500, 1, 'Sindico', sindico)).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.areas_Sociais_Agendamentos.delete).not.toHaveBeenCalled();
    });

    it('morador "exclui" a própria reserva futura: vira cancelado, não some', async () => {
      const { svc, prisma, facial } = build({
        reserva: { ...base, status: 'aprovado', data: dia('2026-06-20'), hora_de: hora(18), hora_ate: hora(22) },
      });
      await svc.removeAgendamento(500, 5, 'Morador', morador);
      expect(prisma.areas_Sociais_Agendamentos.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 500, status: 'aprovado' },
          data: expect.objectContaining({ status: 'cancelado', aprovado_por_nome: 'Cancelado pelo Morador' }),
        }),
      );
      expect(prisma.areas_Sociais_Agendamentos.delete).not.toHaveBeenCalled();
      expect(facial.syncReservaArea).toHaveBeenCalledWith(500);
    });

    it('morador "exclui" o próprio pedido pendente: vira cancelado', async () => {
      const { svc, prisma, facial } = build({
        reserva: { ...base, status: 'pendente', data: dia('2026-06-20'), hora_de: hora(18), hora_ate: hora(22) },
      });
      await svc.removeAgendamento(500, 5, 'Morador', morador);
      expect(prisma.areas_Sociais_Agendamentos.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'cancelado' }) }),
      );
      expect(prisma.areas_Sociais_Agendamentos.delete).not.toHaveBeenCalled();
      expect(facial.syncReservaArea).not.toHaveBeenCalled();
    });

    it('morador tira da lista a própria reserva já cancelada: apaga (não conta no limite)', async () => {
      const { svc, prisma } = build({
        reserva: { ...base, status: 'cancelado', data: dia('2026-06-09'), hora_de: hora(8), hora_ate: hora(10) },
      });
      await svc.removeAgendamento(500, 5, 'Morador', morador);
      expect(prisma.areas_Sociais_Agendamentos.delete).toHaveBeenCalled();
    });

    it('status mudou entre a leitura e a gravação: 409', async () => {
      const { svc, prisma } = build({
        reserva: { ...base, status: 'aprovado', data: dia('2026-06-20'), hora_de: hora(18), hora_ate: hora(22) },
      });
      prisma.areas_Sociais_Agendamentos.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(svc.removeAgendamento(500, 5, 'Morador', morador)).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.areas_Sociais_Agendamentos.delete).not.toHaveBeenCalled();
    });
  });
});
