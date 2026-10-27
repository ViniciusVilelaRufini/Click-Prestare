import { ForbiddenException } from '@nestjs/common';
import { AreasSociaisService } from './areas-sociais.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * A flag `areas_sociais` é o que o síndico usa para tirar do funcionário a
 * gestão de reservas. Ela era cobrada no CRUD de área e no aprovar/recusar,
 * mas não em reservar EM NOME de um apartamento (nasce 'aprovado' e enrola o
 * apartamento no facial) nem em apagar a reserva de outro morador.
 * A reserva do próprio funcionário continua livre (areas-sociais.permissao.spec).
 */
describe('AreasSociaisService — flag areas_sociais nas reservas em nome de terceiros', () => {
  beforeAll(() => jest.useFakeTimers({ advanceTimers: true }).setSystemTime(new Date(Date.UTC(2026, 0, 1, 12, 0, 0))));
  afterAll(() => jest.useRealTimers());

  function build(flagAreas: number, reserva?: any) {
    const prisma: any = {
      isConnected: true,
      areas_Sociais: {
        findUnique: jest.fn(async ({ where }: any) =>
          where.id === 30 ? { id: 30, id_condominio: 2, precisa_autorizacao: 1 } : null,
        ),
      },
      areas_Sociais_Agendamentos: {
        findMany: jest.fn(async () => []),
        create: jest.fn(async () => ({ id: 500, status: 'aprovado' })),
        findUnique: jest.fn(async () => (reserva ? { ...reserva } : null)),
        update: jest.fn(async ({ data }: any) => ({ ...reserva, ...data })),
        delete: jest.fn(async () => ({})),
      },
      areas_Sociais_Manutencoes: { findMany: jest.fn(async () => []) },
      apartamentos: { findUnique: jest.fn(async () => ({ id_condominio: 2 })) },
      apartamentos_Users: {
        findFirst: jest.fn(async () => ({ id_user: 5 })),
        findMany: jest.fn(async () => []),
      },
      sindicos_Condominios: { findFirst: jest.fn(async () => null) },
      // Vínculo do funcionário com o condomínio 2 e a flag pedida.
      funcionarios: {
        findFirst: jest.fn(async ({ where }: any) =>
          Number(where?.id_condominio) === 2 ? { id: 1, areas_sociais: flagAreas, manutencoes_programadas: 1 } : null,
        ),
      },
    };
    const facial: any = { syncReservaArea: jest.fn().mockResolvedValue({}) };
    const tenant = new TenantAccessService(prisma);
    const svc = new AreasSociaisService(
      prisma,
      { sendPushNotification: jest.fn() } as any,
      { isDataUrl: () => false, uploadDataUrl: jest.fn() } as any,
      facial,
      tenant,
    );
    return { svc, prisma };
  }

  const funcionario: JwtPayload = { sub: 6, nome: 'Zelador', typeAccess: 'Funcionario' };
  const emNomeDoApto = {
    id_area_social: 30,
    id_apartamento: 100,
    data: '20/05/2026',
    horaDe: '10:00',
    horaAte: '11:00',
    agendarPeloSindico: true,
  };

  it('NEGA reservar em nome de apartamento sem a flag', async () => {
    const { svc, prisma } = build(0);
    await expect(svc.insertAgendamento({ ...emNomeDoApto }, 6, 'Funcionario', funcionario)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.areas_Sociais_Agendamentos.create).not.toHaveBeenCalled();
  });

  it('PERMITE reservar em nome de apartamento com a flag', async () => {
    const { svc, prisma } = build(1);
    await svc.insertAgendamento({ ...emNomeDoApto }, 6, 'Funcionario', funcionario);
    expect(prisma.areas_Sociais_Agendamentos.create).toHaveBeenCalled();
  });

  it('NEGA apagar a reserva de OUTRO morador sem a flag', async () => {
    const { svc, prisma } = build(0, { id: 500, id_user: 5, status: 'pendente', area: { id_condominio: 2 } });
    await expect(svc.removeAgendamento(500, 6, 'Funcionario', funcionario)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.areas_Sociais_Agendamentos.delete).not.toHaveBeenCalled();
  });

  it('PERMITE o funcionário apagar a PRÓPRIA reserva mesmo sem a flag', async () => {
    const { svc, prisma } = build(0, { id: 501, id_user: 6, status: 'pendente', area: { id_condominio: 2 } });
    await svc.removeAgendamento(501, 6, 'Funcionario', funcionario);
    expect(prisma.areas_Sociais_Agendamentos.delete).toHaveBeenCalled();
  });
});
