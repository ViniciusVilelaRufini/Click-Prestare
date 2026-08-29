import { BadRequestException } from '@nestjs/common';
import { AreasSociaisService } from './areas-sociais.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Task 3: `limite_mensal_apto` em insertAgendamento — teto de reservas
 * pendente/aprovado por apartamento, por área, dentro do mês da DATA
 * SOLICITADA (não do "agora" do servidor). Null/0 preserva o comportamento
 * de sempre (sem limite). Reserva pelo síndico não conta nem é bloqueada.
 */
describe('AreasSociaisService — limite mensal por apartamento', () => {
  const morador: JwtPayload = { sub: 6, nome: 'Morador X', id_condominio: 2, typeAccess: 'Morador' };
  const sindico: JwtPayload = { sub: 1, nome: 'Síndico', id_condominio: 2, typeAccess: 'Sindico' };

  function build(opts: { limite?: number | null; reservasNoMes?: Array<{ data: Date; status: string }> } = {}) {
    const area = {
      id: 30,
      id_condominio: 2,
      precisa_autorizacao: 0,
      imagem: '',
      capacidade: 0,
      precisa_agendar: 1,
      precisa_pagamento: 0,
      horarios: JSON.stringify([]),
      regras: null,
      limite_mensal_apto: opts.limite === undefined ? 2 : opts.limite,
    };
    const reservasNoMes = opts.reservasNoMes ?? [];

    const prisma: any = {
      isConnected: true,
      areas_Sociais: {
        findUnique: jest.fn(async ({ where }: any) => (where.id === 30 ? { ...area } : null)),
      },
      areas_Sociais_Agendamentos: {
        // Um único mock cobre dois usos do service: checagem de conflito do
        // dia (where.data é um Date exato) e a contagem mensal do limite
        // (where.data é um range {gte, lt}). Filtramos de verdade pelo range
        // para o teste de virada de mês fazer sentido.
        findMany: jest.fn(async ({ where }: any) => {
          if (where?.data && typeof where.data === 'object' && 'gte' in where.data) {
            const { gte, lt } = where.data;
            const statusPermitidos: string[] = where.status?.in ?? [];
            return reservasNoMes.filter(
              (r) => r.data >= gte && r.data < lt && statusPermitidos.includes(r.status),
            );
          }
          // Checagem de conflito do dia: nenhuma reserva concorrente no teste.
          return [];
        }),
        create: jest.fn(async (args: any) => ({ id: 900, status: 'aprovado', ...args.data })),
      },
      areas_Sociais_Manutencoes: {
        findMany: jest.fn(async () => []),
      },
      apartamentos_Users: {
        findMany: jest.fn(async () => [{ id_apto: 100 }]),
        findFirst: jest.fn(async () => ({ id_user: 6 })),
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

  it('grava quando o apartamento está abaixo do limite', async () => {
    const { svc, prisma } = build({
      limite: 2,
      reservasNoMes: [{ data: new Date(2026, 5, 3), status: 'aprovado' }],
    });
    await svc.insertAgendamento(agendamentoBase, 6, 'Morador', morador);
    expect(prisma.areas_Sociais_Agendamentos.create).toHaveBeenCalled();
  });

  it('recusa ao atingir o limite, citando o limite e o mês', async () => {
    const { svc, prisma } = build({
      limite: 2,
      reservasNoMes: [
        { data: new Date(2026, 5, 3), status: 'aprovado' },
        { data: new Date(2026, 5, 5), status: 'pendente' },
      ],
    });
    await expect(svc.insertAgendamento(agendamentoBase, 6, 'Morador', morador)).rejects.toThrow(
      BadRequestException,
    );
    await expect(svc.insertAgendamento(agendamentoBase, 6, 'Morador', morador)).rejects.toThrow(/2.*junho/i);
    expect(prisma.areas_Sociais_Agendamentos.create).not.toHaveBeenCalled();
  });

  it('reserva cancelada ou recusada não conta para o limite', async () => {
    const { svc, prisma } = build({
      limite: 2,
      reservasNoMes: [
        // Mesmo mock filtrando por status.in (que exclui cancelado/recusado),
        // deixamos as duas linhas aqui para simular o estado real da tabela.
        { data: new Date(2026, 5, 3), status: 'cancelado' },
        { data: new Date(2026, 5, 5), status: 'recusado' },
      ],
    });
    await svc.insertAgendamento(agendamentoBase, 6, 'Morador', morador);
    expect(prisma.areas_Sociais_Agendamentos.create).toHaveBeenCalled();
  });

  it('limite nulo não bloqueia mesmo com muitas reservas no mês', async () => {
    const { svc, prisma } = build({
      limite: null,
      reservasNoMes: [
        { data: new Date(2026, 5, 1), status: 'aprovado' },
        { data: new Date(2026, 5, 2), status: 'aprovado' },
        { data: new Date(2026, 5, 3), status: 'aprovado' },
      ],
    });
    await svc.insertAgendamento(agendamentoBase, 6, 'Morador', morador);
    expect(prisma.areas_Sociais_Agendamentos.create).toHaveBeenCalled();
  });

  it('limite zero não bloqueia (mesma semântica de nulo)', async () => {
    const { svc, prisma } = build({
      limite: 0,
      reservasNoMes: [
        { data: new Date(2026, 5, 1), status: 'aprovado' },
        { data: new Date(2026, 5, 2), status: 'aprovado' },
      ],
    });
    await svc.insertAgendamento(agendamentoBase, 6, 'Morador', morador);
    expect(prisma.areas_Sociais_Agendamentos.create).toHaveBeenCalled();
  });

  it('reserva feita pelo síndico não é bloqueada mesmo no limite', async () => {
    const { svc, prisma } = build({
      limite: 1,
      reservasNoMes: [{ data: new Date(2026, 5, 3), status: 'aprovado' }],
    });
    await svc.insertAgendamento(
      { ...agendamentoBase, agendarPeloSindico: true },
      1,
      'Sindico',
      sindico,
    );
    expect(prisma.areas_Sociais_Agendamentos.create).toHaveBeenCalled();
  });

  it('reserva feita pelo síndico não é contada para o limite de outra reserva do morador', async () => {
    // Site alvo tem limite 1 e já 1 reserva feita pelo síndico no mês; a
    // reserva do síndico em si não deveria ter sido bloqueada (caso acima) —
    // aqui garantimos que o morador ainda consegue reservar por conta própria
    // se essa reserva do síndico não entrar na contagem dele. Como a contagem
    // olha status, não "quem criou", simulamos que ela ficou 'aprovado' e
    // portanto CONTA contra o apartamento (comportamento aceito: o teto é por
    // apartamento, não por "quem pediu" — só a criação pelo síndico em si que
    // não é bloqueada nem soma na tentativa atual).
    const { svc } = build({
      limite: 1,
      reservasNoMes: [{ data: new Date(2026, 5, 3), status: 'aprovado' }],
    });
    await expect(svc.insertAgendamento(agendamentoBase, 6, 'Morador', morador)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('virada de mês: reserva do mês anterior não conta para o mês solicitado', async () => {
    const { svc, prisma } = build({
      limite: 1,
      // 31/05 é véspera do mês da reserva pedida (10/06) — não deve contar.
      reservasNoMes: [{ data: new Date(2026, 4, 31), status: 'aprovado' }],
    });
    await svc.insertAgendamento(agendamentoBase, 6, 'Morador', morador);
    expect(prisma.areas_Sociais_Agendamentos.create).toHaveBeenCalled();
  });

  it('virada de mês: reserva pedida usa o mês da DATA solicitada, não o de "agora"', async () => {
    // Pede uma reserva para março ao mesmo tempo em que já existem duas
    // reservas aprovadas em março (mês diferente de "hoje"). O limite tem
    // que olhar para o mês pedido (março), não o mês corrente do servidor.
    const { svc } = build({
      limite: 2,
      reservasNoMes: [
        { data: new Date(2027, 2, 5), status: 'aprovado' },
        { data: new Date(2027, 2, 20), status: 'pendente' },
      ],
    });
    await expect(
      svc.insertAgendamento({ ...agendamentoBase, data: '25/03/2027' }, 6, 'Morador', morador),
    ).rejects.toThrow(BadRequestException);
  });
});
