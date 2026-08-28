import { ForbiddenException } from '@nestjs/common';
import { AreasSociaisService } from './areas-sociais.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Cobre os dois achados mais graves do módulo de áreas sociais:
 * 1. `agendarPeloSindico` deixava qualquer morador auto-aprovar a própria
 *    reserva (pulando a fila de autorização) — agora exige assertStaff.
 * 2. `remove`/`updateStatusAgendamento` não checavam tenant nem papel —
 *    qualquer usuário apagava área/aprovava reserva de qualquer condomínio.
 */
describe('AreasSociaisService — autorização (agendarPeloSindico + IDOR)', () => {
  const areaCond2 = { id: 30, id_condominio: 2, precisa_autorizacao: 1 };

  function build(overrides: Partial<any> = {}) {
    const prisma: any = {
      isConnected: true,
      areas_Sociais: {
        findUnique: jest.fn(async ({ where }: any) => (where.id === 30 ? { ...areaCond2 } : null)),
        delete: jest.fn(async () => ({})),
      },
      areas_Sociais_Agendamentos: {
        findMany: jest.fn(async () => []),
        create: jest.fn(async () => ({ id: 500, status: 'pendente' })),
        findUnique: jest.fn(async () => null),
      },
      areas_Sociais_Manutencoes: {
        findMany: jest.fn(async () => []),
      },
      // Dois usos, distinguidos pelo `where`:
      //  - `id_user`  → TenantAccessService resolvendo o vínculo do morador
      //                 mobile (que não carrega id_condominio no token);
      //  - `id_apto`  → insertAgendamento procurando o dono da reserva feita
      //                 pelo operador em nome do apartamento.
      apartamentos_Users: {
        findFirst: jest.fn(async ({ where }: any) => {
          if (where?.id_user !== undefined) {
            return Number(where.id_user) === 5 ? { id_apto: 100 } : null;
          }
          return { id_user: 5 };
        }),
        findMany: jest.fn(async () => []),
      },
      sindicos_Condominios: { findFirst: jest.fn(async () => null) },
      ...overrides,
    };
    const notifications: any = { sendPushNotification: jest.fn() };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const facial: any = { syncReservaArea: jest.fn().mockResolvedValue({}) };
    const tenant = new TenantAccessService(prisma);
    const svc = new AreasSociaisService(prisma, notifications, storage, facial, tenant);
    return { svc, prisma };
  }

  // Token de morador é o que o login mobile emite: `typeAccess` no topo e
  // SEM id_condominio — quem carrega id_condominio no token é o operador do
  // console, e é exatamente por essa presença que o assertOperador o
  // reconhece. Modelar morador com id_condominio faria ele passar por
  // operador no teste, coisa que nenhum login de verdade produz.
  const moradorCond2: JwtPayload = { sub: 5, nome: 'Morador X', typeAccess: 'Morador' };
  const funcionarioCond2: JwtPayload = { sub: 6, nome: 'Porteiro Y', id_condominio: 2, typeAccess: 'Funcionario' };
  const moradorCond1: JwtPayload = { sub: 7, nome: 'Morador de outro condo', typeAccess: 'Morador' };

  describe('insertAgendamento — agendarPeloSindico', () => {
    const agendamento = {
      id_area_social: 30,
      id_apartamento: 100,
      data: '20/05/2026',
      horaDe: '10:00',
      horaAte: '11:00',
      agendarPeloSindico: true,
    };

    it('NEGA morador auto-aprovar a própria reserva via agendarPeloSindico', async () => {
      const { svc, prisma } = build();
      await expect(
        svc.insertAgendamento(agendamento, 5, 'Morador', moradorCond2),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.areas_Sociais_Agendamentos.create).not.toHaveBeenCalled();
    });

    it('PERMITE funcionário usar agendarPeloSindico no próprio condomínio', async () => {
      const { svc, prisma } = build();
      await svc.insertAgendamento(agendamento, 6, 'Funcionario', funcionarioCond2);
      expect(prisma.areas_Sociais_Agendamentos.create).toHaveBeenCalled();
    });

    it('NEGA reserva em área de outro condomínio (tenant)', async () => {
      const { svc, prisma } = build();
      await expect(
        svc.insertAgendamento({ ...agendamento, agendarPeloSindico: false }, 7, 'Morador', moradorCond1),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.areas_Sociais_Agendamentos.create).not.toHaveBeenCalled();
    });
  });

  describe('remove (área social)', () => {
    it('NEGA morador remover área social', async () => {
      const { svc, prisma } = build();
      await expect(svc.remove(30, moradorCond2)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.areas_Sociais.delete).not.toHaveBeenCalled();
    });

    it('NEGA funcionário de outro condomínio remover área do condomínio 2', async () => {
      const { svc, prisma } = build();
      const funcionarioCond1: JwtPayload = { sub: 8, nome: 'Porteiro Outro', id_condominio: 1, typeAccess: 'Funcionario' };
      await expect(svc.remove(30, funcionarioCond1)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.areas_Sociais.delete).not.toHaveBeenCalled();
    });

    it('PERMITE funcionário do mesmo condomínio remover área social', async () => {
      const { svc, prisma } = build();
      await svc.remove(30, funcionarioCond2);
      expect(prisma.areas_Sociais.delete).toHaveBeenCalled();
    });
  });

  describe('updateStatusAgendamento (aprovar/recusar reserva)', () => {
    it('NEGA morador aprovar/recusar reserva', async () => {
      const { svc } = build();
      await expect(
        svc.updateStatusAgendamento(500, true, '', moradorCond2),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('recusa pelo síndico grava status "recusado" (não "cancelado")', async () => {
      const agendamento500 = { id: 500, id_user: 5, status: 'pendente', area: { id_condominio: 2 } };
      const { svc, prisma } = build({
        areas_Sociais_Agendamentos: {
          findMany: jest.fn(async () => []),
          create: jest.fn(async () => ({ id: 500, status: 'pendente' })),
          findUnique: jest.fn(async () => ({ ...agendamento500 })),
          update: jest.fn(async ({ data }: any) => ({ ...agendamento500, ...data })),
        },
      });
      await svc.updateStatusAgendamento(500, false, '', funcionarioCond2);
      expect(prisma.areas_Sociais_Agendamentos.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'recusado' }) }),
      );
    });
  });

  describe('removeAgendamento — status gravado ao cancelar', () => {
    // Agendamento 500 já aprovado, pertence ao morador de sub=5, no condomínio 2.
    const agendamentoAprovado = { id: 500, id_user: 5, status: 'aprovado', area: { id_condominio: 2 } };

    it('dono cancelando a própria reserva aprovada grava "cancelado" (não "recusado")', async () => {
      const { svc, prisma } = build({
        areas_Sociais_Agendamentos: {
          findMany: jest.fn(async () => []),
          create: jest.fn(async () => ({ id: 500, status: 'pendente' })),
          findUnique: jest.fn(async () => ({ ...agendamentoAprovado })),
          update: jest.fn(async ({ data }: any) => ({ ...agendamentoAprovado, ...data })),
          delete: jest.fn(async () => ({})),
        },
      });
      await svc.removeAgendamento(500, 5, 'Morador', moradorCond2);
      expect(prisma.areas_Sociais_Agendamentos.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'cancelado' } }),
      );
      expect(prisma.areas_Sociais_Agendamentos.delete).toHaveBeenCalled();
    });

    it('síndico removendo reserva aprovada de outro morador também grava "cancelado"', async () => {
      const { svc, prisma } = build({
        areas_Sociais_Agendamentos: {
          findMany: jest.fn(async () => []),
          create: jest.fn(async () => ({ id: 500, status: 'pendente' })),
          findUnique: jest.fn(async () => ({ ...agendamentoAprovado })),
          update: jest.fn(async ({ data }: any) => ({ ...agendamentoAprovado, ...data })),
          delete: jest.fn(async () => ({})),
        },
      });
      await svc.removeAgendamento(500, 6, 'Funcionario', funcionarioCond2);
      expect(prisma.areas_Sociais_Agendamentos.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'cancelado' } }),
      );
    });
  });
});
