import { BadRequestException } from '@nestjs/common';
import { AreasSociaisService } from './areas-sociais.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Task 2: `convidados` em insertAgendamento — opcional, validado contra
 * `capacidade` só quando informado e quando a área tem capacidade > 0.
 * Ausente continua válido (app antigo não manda o campo).
 */
describe('AreasSociaisService — convidados x capacidade', () => {
  const morador: JwtPayload = { sub: 6, nome: 'Morador X', id_condominio: 2, typeAccess: 'Morador' };

  function build(opts: { capacidade?: number | null } = {}) {
    const area = {
      id: 30,
      id_condominio: 2,
      precisa_autorizacao: 0,
      imagem: '',
      capacidade: opts.capacidade === undefined ? 10 : opts.capacidade,
      precisa_agendar: 1,
      precisa_pagamento: 0,
      horarios: JSON.stringify([]),
      regras: null,
    };
    const prisma: any = {
      isConnected: true,
      areas_Sociais: {
        findUnique: jest.fn(async ({ where }: any) => (where.id === 30 ? { ...area } : null)),
      },
      areas_Sociais_Agendamentos: {
        findMany: jest.fn(async () => []),
        create: jest.fn(async (args: any) => ({ id: 500, status: 'aprovado', ...args.data })),
      },
      areas_Sociais_Manutencoes: {
        findMany: jest.fn(async () => []),
      },
      apartamentos_Users: {
        findMany: jest.fn(async () => [{ id_apto: 100 }]),
      },
      facial_Devices: { count: jest.fn(async () => 0) },
      $queryRaw: jest.fn(async () => []),
    };
    const notifications: any = { sendPushNotification: jest.fn() };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const facial: any = { syncReservaArea: jest.fn().mockResolvedValue({}) };
    const tenant = new TenantAccessService(prisma);
    const svc = new AreasSociaisService(prisma, notifications, storage, facial, tenant);
    return { svc, prisma };
  }

  const agendamentoBase = {
    id_area_social: 30,
    id_apartamento: 100,
    data: '10/06/2026',
    horaDe: '10:00',
    horaAte: '11:00',
  };

  it('grava a reserva quando convidados está dentro da capacidade', async () => {
    const { svc, prisma } = build({ capacidade: 10 });
    await svc.insertAgendamento({ ...agendamentoBase, convidados: 8 }, 6, 'Morador', morador);
    const dataArg = prisma.areas_Sociais_Agendamentos.create.mock.calls[0][0].data;
    expect(dataArg.convidados).toBe(8);
  });

  it('recusa quando convidados excede a capacidade', async () => {
    const { svc, prisma } = build({ capacidade: 10 });
    await expect(
      svc.insertAgendamento({ ...agendamentoBase, convidados: 25 }, 6, 'Morador', morador),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.areas_Sociais_Agendamentos.create).not.toHaveBeenCalled();
  });

  it('grava a reserva quando convidados está ausente (app antigo)', async () => {
    const { svc, prisma } = build({ capacidade: 10 });
    await svc.insertAgendamento({ ...agendamentoBase }, 6, 'Morador', morador);
    const dataArg = prisma.areas_Sociais_Agendamentos.create.mock.calls[0][0].data;
    expect(dataArg.convidados).toBeNull();
  });

  it('área com capacidade 0 não valida convidados (sem limite configurado)', async () => {
    const { svc, prisma } = build({ capacidade: 0 });
    await svc.insertAgendamento({ ...agendamentoBase, convidados: 999 }, 6, 'Morador', morador);
    const dataArg = prisma.areas_Sociais_Agendamentos.create.mock.calls[0][0].data;
    expect(dataArg.convidados).toBe(999);
  });

  it('área com capacidade nula não valida convidados (sem limite configurado)', async () => {
    const { svc, prisma } = build({ capacidade: null });
    await svc.insertAgendamento({ ...agendamentoBase, convidados: 999 }, 6, 'Morador', morador);
    const dataArg = prisma.areas_Sociais_Agendamentos.create.mock.calls[0][0].data;
    expect(dataArg.convidados).toBe(999);
  });

  it('recusa convidados zero ou negativo', async () => {
    const { svc } = build({ capacidade: 10 });
    await expect(
      svc.insertAgendamento({ ...agendamentoBase, convidados: 0 }, 6, 'Morador', morador),
    ).rejects.toThrow(BadRequestException);
    await expect(
      svc.insertAgendamento({ ...agendamentoBase, convidados: -5 }, 6, 'Morador', morador),
    ).rejects.toThrow(BadRequestException);
  });

  it('get devolve o campo convidados nos agendamentos da área', async () => {
    const { svc, prisma } = build({ capacidade: 10 });
    prisma.areas_Sociais_Agendamentos.findMany = jest.fn(async () => [
      {
        id: 1,
        status: 'aprovado',
        apartamento: { bloco: 'A', apto: '101' },
        data: new Date(2026, 5, 10),
        hora_de: new Date(1970, 0, 1, 10, 0, 0),
        hora_ate: new Date(1970, 0, 1, 11, 0, 0),
        convidados: 8,
      },
    ]);
    const resultado = await svc.get(2, 30, morador);
    expect(resultado.agendamentos[0].convidados).toBe(8);
  });
});
