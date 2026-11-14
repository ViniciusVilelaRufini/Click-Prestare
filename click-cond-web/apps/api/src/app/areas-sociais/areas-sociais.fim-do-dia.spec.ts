import { BadRequestException, ConflictException } from '@nestjs/common';
import { AreasSociaisService } from './areas-sociais.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Pendências da revisão da raia r (00:00 = meia-noite do fim do dia):
 *  - manutenção que termina 00:00 no mesmo dia em que começa ficava com o fim
 *    antes do início: a criação recusava e uma linha antiga não bloqueava nada;
 *  - virada de ano no fim da reserva (31/12 20:00–00:00);
 *  - reserva com término antes do início era gravada;
 *  - reserva feita pela portaria não dizia quem agendou (aprovado_por_nome).
 * O processo roda em UTC (jest.config.cts); as horas abaixo são de Brasília.
 */
const area = {
  id: 30,
  id_condominio: 2,
  nome: 'Salão',
  precisa_autorizacao: 0,
  imagem: '',
  capacidade: 0,
  precisa_agendar: 1,
  precisa_pagamento: 0,
  horarios: JSON.stringify(
    Array.from({ length: 7 }).map(() => ({ horarios: [{ horarioDe: '18:00', horarioAte: '22:00' }] })),
  ),
};
const funcionario: JwtPayload = { sub: 6, nome: 'Porteiro Y', id_condominio: 2, typeAccess: 'Funcionario' };
const porteiro: JwtPayload = { sub: 9, nome: 'Carlos', id_condominio: 2, turno: 'Diurno' } as any;
const sindico: JwtPayload = { sub: 1, nome: 'Síndico', id_condominio: 2, typeAccess: 'Sindico' };

function build(opts: { manutencoes?: any[]; agendamentos?: any[]; reserva?: any } = {}) {
  const prisma: any = {
    isConnected: true,
    areas_Sociais: { findUnique: jest.fn(async () => ({ ...area })) },
    areas_Sociais_Agendamentos: {
      findMany: jest.fn(async () => opts.agendamentos ?? []),
      findUnique: jest.fn(async () => (opts.reserva ? { ...opts.reserva } : null)),
      create: jest.fn(async ({ data }: any) => ({ id: 500, ...data })),
      updateMany: jest.fn(async () => ({ count: 1 })),
      update: jest.fn(async () => ({})),
    },
    areas_Sociais_Manutencoes: {
      findMany: jest.fn(async () => opts.manutencoes ?? []),
      create: jest.fn(async () => ({})),
    },
    apartamentos: { findUnique: jest.fn(async () => ({ id_condominio: 2 })) },
    apartamentos_Users: { findFirst: jest.fn(async () => ({ id_user: 5 })), findMany: jest.fn(async () => []) },
    facial_Devices: { count: jest.fn(async () => 0) },
    $queryRaw: jest.fn(async () => []),
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };
  const notifications: any = { sendPushNotification: jest.fn() };
  const storage: any = { isDataUrl: () => false };
  const facial: any = { syncReservaArea: jest.fn().mockResolvedValue({}) };
  const tenant = new TenantAccessService(prisma);
  jest.spyOn(tenant, 'assertEntidade').mockResolvedValue(undefined as any);
  jest.spyOn(tenant, 'assertCondominio').mockResolvedValue(undefined as any);
  jest.spyOn(tenant, 'assertPermissaoFuncionario').mockResolvedValue(undefined as any);
  const svc = new AreasSociaisService(prisma, notifications, storage, facial, tenant);
  return { svc, prisma };
}

const hora = (h: number, m = 0) => new Date(1970, 0, 1, h, m, 0);
/** "Agora" em Brasília (UTC−3), no relógio de parede. */
const agoraBr = (a: number, mes: number, d: number, h: number, m = 0) =>
  jest.useFakeTimers({ advanceTimers: true }).setSystemTime(new Date(Date.UTC(a, mes - 1, d, h + 3, m)));

afterEach(() => jest.useRealTimers());

describe('manutenção que termina 00:00', () => {
  const manut = {
    id: 1,
    descricao: 'Pintura',
    data_inicio: new Date(2026, 5, 10),
    hora_inicio: hora(20),
    data_termino: new Date(2026, 5, 10),
    hora_termino: hora(0),
  };

  it('criar 20:00 → 00:00 no mesmo dia é aceito (vai até a meia-noite)', async () => {
    agoraBr(2026, 6, 1, 9);
    const { svc, prisma } = build();
    await svc.insertManutencao(
      { id_area_social: 30, descricao: 'X', data_inicio: '10/06/2026', data_termino: '10/06/2026', hora_inicio: '20:00', hora_termino: '00:00' },
      sindico,
    );
    expect(prisma.areas_Sociais_Manutencoes.create).toHaveBeenCalled();
  });

  it('a reserva das 21:00 às 23:00 do mesmo dia é recusada por manutenção', async () => {
    agoraBr(2026, 6, 1, 9);
    const { svc, prisma } = build({ manutencoes: [manut] });
    await expect(
      svc.insertAgendamento(
        { id_area_social: 30, id_apartamento: 100, data: '10/06/2026', horaDe: '21:00', horaAte: '23:00' },
        6, 'Funcionario', funcionario,
      ),
    ).rejects.toThrow('Esta área está em manutenção no horário solicitado.');
    expect(prisma.areas_Sociais_Agendamentos.create).not.toHaveBeenCalled();
  });

  it('o bloco 18:00–22:00 daquele dia some dos horários livres', async () => {
    agoraBr(2026, 6, 10, 9);
    const { svc } = build({ manutencoes: [manut] });
    const r: any = await svc.get(2, 30, funcionario);
    expect(r.horarios_livres['10/06/2026']).toBeUndefined();
    expect(r.horarios_livres['11/06/2026']).toBeDefined();
  });
});

describe('virada de ano no fim da reserva', () => {
  const reserva = {
    id: 500,
    id_user: 5,
    id_area_social: 30,
    status: 'aprovado',
    data: new Date(Date.UTC(2026, 11, 31)),
    hora_de: hora(20),
    hora_ate: hora(0),
    area: { id_condominio: 2 },
  };

  it('31/12 às 23:30: a reserva 20:00–00:00 ainda não aconteceu (pode cancelar)', async () => {
    agoraBr(2026, 12, 31, 23, 30);
    const { svc, prisma } = build({ reserva });
    await svc.updateStatusAgendamento(500, 'cancelado', '', sindico);
    expect(prisma.areas_Sociais_Agendamentos.updateMany).toHaveBeenCalled();
  });

  it('01/01 às 00:30: a mesma reserva já aconteceu', async () => {
    agoraBr(2027, 1, 1, 0, 30);
    const { svc, prisma } = build({ reserva });
    await expect(svc.updateStatusAgendamento(500, 'cancelado', '', sindico)).rejects.toThrow(
      new ConflictException('Esta reserva já aconteceu.'),
    );
    expect(prisma.areas_Sociais_Agendamentos.updateMany).not.toHaveBeenCalled();
  });
});

describe('insertAgendamento — término e autoria', () => {
  const pedido = { id_area_social: 30, id_apartamento: 100, data: '10/06/2026' };

  it('término antes do início: 400 e nada é gravado', async () => {
    agoraBr(2026, 6, 1, 9);
    const { svc, prisma } = build();
    await expect(
      svc.insertAgendamento({ ...pedido, horaDe: '18:00', horaAte: '10:00' }, 6, 'Funcionario', funcionario),
    ).rejects.toThrow(BadRequestException);
    await expect(
      svc.insertAgendamento({ ...pedido, horaDe: '18:00', horaAte: '18:00' }, 6, 'Funcionario', funcionario),
    ).rejects.toThrow('O término da reserva precisa ser depois do início.');
    expect(prisma.areas_Sociais_Agendamentos.create).not.toHaveBeenCalled();
  });

  it('término 00:00 continua valendo como fim do dia', async () => {
    agoraBr(2026, 6, 1, 9);
    const { svc, prisma } = build();
    await svc.insertAgendamento({ ...pedido, horaDe: '20:00', horaAte: '00:00' }, 6, 'Funcionario', funcionario);
    expect(prisma.areas_Sociais_Agendamentos.create).toHaveBeenCalled();
  });

  it('reserva agendada pela portaria grava quem agendou como aprovador', async () => {
    agoraBr(2026, 6, 1, 9);
    const { svc, prisma } = build();
    await svc.insertAgendamento(
      { ...pedido, horaDe: '18:00', horaAte: '22:00', agendarPeloSindico: true },
      null, 'Operador', porteiro,
    );
    expect(prisma.areas_Sociais_Agendamentos.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'aprovado', aprovado_por_nome: 'Carlos', aprovado_em: expect.any(Date) }),
    });
  });
});

describe('bloco da grade que atravessa a meia-noite', () => {
  it('22:00–02:00 não aparece em horarios_livres; 20:00–24:00 aparece', async () => {
    agoraBr(2026, 6, 10, 9);
    const { svc, prisma } = build();
    prisma.areas_Sociais.findUnique.mockResolvedValue({
      ...area,
      horarios: JSON.stringify(
        Array.from({ length: 7 }).map(() => ({
          horarios: [{ horarioDe: '22:00', horarioAte: '02:00' }, { horarioDe: '20:00', horarioAte: '24:00' }],
        })),
      ),
    });
    const r: any = await svc.get(2, 30, funcionario);
    expect(r.horarios_livres['11/06/2026']).toEqual([{ horarioDe: '20:00', horarioAte: '24:00' }]);
  });
});

describe('updateAgendamento — término e início', () => {
  const reserva = {
    id: 500, id_user: 5, id_area_social: 30, status: 'aprovado',
    data: new Date(Date.UTC(2026, 5, 20)), hora_de: hora(18), hora_ate: hora(22), area: { id_condominio: 2 },
  };

  it('término antes do início (só o término mudou): 400 e nada é gravado', async () => {
    const { svc, prisma } = build({ reserva });
    await expect(svc.updateAgendamento({ id: 500, horaAte: '17:00' }, sindico)).rejects.toThrow(
      'O término da reserva precisa ser depois do início.',
    );
    expect(prisma.areas_Sociais_Agendamentos.update).not.toHaveBeenCalled();
  });

  it('término 00:00 continua valendo como fim do dia', async () => {
    const { svc, prisma } = build({ reserva });
    await svc.updateAgendamento({ id: 500, horaAte: '00:00' }, sindico);
    expect(prisma.areas_Sociais_Agendamentos.update).toHaveBeenCalled();
  });
});
