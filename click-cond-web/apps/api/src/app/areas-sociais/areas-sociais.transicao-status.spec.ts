import { BadRequestException, ConflictException } from '@nestjs/common';
import { AreasSociaisService } from './areas-sociais.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Aprovar/recusar/cancelar mudam o status a partir do estado ATUAL da reserva,
 * não do que a tela do porteiro achava que era. Antes, o update era cego:
 * "Aprovar" numa reserva já cancelada (lista velha na tela) a ressuscitava —
 * e, se o horário tinha sido reservado por outro apartamento nesse meio
 * tempo, ficavam duas reservas aprovadas no mesmo horário.
 */
describe('AreasSociaisService — transição de status da reserva', () => {
  const funcionario: JwtPayload = { sub: 6, nome: 'Porteiro Y', id_condominio: 2, typeAccess: 'Funcionario' };
  const morador: JwtPayload = { sub: 5, nome: 'Morador X', typeAccess: 'Morador' };

  function reserva(overrides: Partial<any> = {}) {
    return {
      id: 500,
      id_user: 5,
      id_area_social: 30,
      id_apartamento: 100,
      status: 'pendente',
      data: new Date(2026, 5, 10),
      hora_de: new Date(1970, 0, 1, 10, 0, 0),
      hora_ate: new Date(1970, 0, 1, 12, 0, 0),
      area: { id_condominio: 2, nome: 'Salão' },
      user: { fcm_token: null },
      ...overrides,
    };
  }

  /**
   * `tabela` é o estado do banco: findMany/updateMany honram as cláusulas que
   * o service usa (status, id, id_area_social, NOT id) — o bastante para o
   * teste pegar se a condição sobre o status atual sumir do update.
   */
  function build(tabela: any[]) {
    const linhas = tabela.map((r) => ({ ...r }));
    const casa = (r: any, where: any) => {
      if (where.id !== undefined && typeof where.id === 'number' && r.id !== where.id) return false;
      if (where.id?.not !== undefined && r.id === where.id.not) return false;
      if (where.NOT?.id !== undefined && r.id === where.NOT.id) return false;
      if (where.id_area_social !== undefined && r.id_area_social !== where.id_area_social) return false;
      if (typeof where.status === 'string' && r.status !== where.status) return false;
      if (where.status?.in && !where.status.in.includes(r.status)) return false;
      return true;
    };
    const prisma: any = {
      isConnected: true,
      areas_Sociais_Agendamentos: {
        findUnique: jest.fn(async ({ where }: any) => {
          const r = linhas.find((l) => l.id === where.id);
          return r ? { ...r } : null;
        }),
        findMany: jest.fn(async ({ where }: any) => linhas.filter((l) => casa(l, where)).map((l) => ({ ...l }))),
        update: jest.fn(async ({ where, data }: any) => {
          const r = linhas.find((l) => l.id === where.id);
          Object.assign(r, data);
          return { ...r };
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const alvo = linhas.filter((l) => casa(l, where));
          alvo.forEach((l) => Object.assign(l, data));
          return { count: alvo.length };
        }),
      },
      apartamentos_Users: { findFirst: jest.fn(async () => ({ id_apto: 100 })) },
      sindicos_Condominios: { findFirst: jest.fn(async () => null) },
      funcionarios: {
        findFirst: jest.fn(async ({ where }: any) => (Number(where?.id_condominio) === 2 ? { areas_sociais: 1 } : null)),
      },
    };
    const notifications: any = { sendPushNotification: jest.fn() };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const facial: any = { syncReservaArea: jest.fn().mockResolvedValue({}) };
    const svc = new AreasSociaisService(prisma, notifications, storage, facial, new TenantAccessService(prisma));
    return { svc, prisma, linhas, facial };
  }

  it('Aprovar reserva já cancelada: 409 "já foi cancelada" e o status não muda', async () => {
    const { svc, linhas, facial } = build([reserva({ status: 'cancelado' })]);
    const erro = await svc.updateStatusAgendamento(500, true, '', funcionario).catch((e) => e);
    expect(erro).toBeInstanceOf(ConflictException);
    expect(erro.message).toBe('Esta reserva já foi cancelada.');
    expect(linhas[0].status).toBe('cancelado');
    expect(facial.syncReservaArea).not.toHaveBeenCalled();
  });

  it('Recusar reserva já aprovada: 409 "já foi aprovada"', async () => {
    const { svc, linhas } = build([reserva({ status: 'aprovado' })]);
    const erro = await svc.updateStatusAgendamento(500, false, '', funcionario).catch((e) => e);
    expect(erro).toBeInstanceOf(ConflictException);
    expect(erro.message).toBe('Esta reserva já foi aprovada.');
    expect(linhas[0].status).toBe('aprovado');
  });

  it('Cancelar reserva já recusada: 409 "já foi recusada"', async () => {
    const { svc, linhas } = build([reserva({ status: 'recusado' })]);
    const erro = await svc.updateStatusAgendamento(500, 'cancelado', '', funcionario).catch((e) => e);
    expect(erro).toBeInstanceOf(ConflictException);
    expect(erro.message).toBe('Esta reserva já foi recusada.');
    expect(linhas[0].status).toBe('recusado');
  });

  it('o update é condicional ao status lido: se mudou entre a leitura e a gravação, 409', async () => {
    const { svc, prisma, linhas } = build([reserva({ status: 'pendente' })]);
    // Outra aba aprova no meio do caminho: a leitura viu 'pendente', a gravação já encontra 'aprovado'.
    const original = prisma.areas_Sociais_Agendamentos.findMany;
    prisma.areas_Sociais_Agendamentos.findMany = jest.fn(async (args: any) => {
      const r = await original(args);
      linhas[0].status = 'aprovado';
      return r;
    });
    const erro = await svc.updateStatusAgendamento(500, true, '', funcionario).catch((e) => e);
    expect(erro).toBeInstanceOf(ConflictException);
    expect(erro.message).toBe('Esta reserva já foi aprovada.');
    expect(prisma.areas_Sociais_Agendamentos.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 500, status: 'pendente' }) }),
    );
  });

  it('Aprovar com outra reserva APROVADA no mesmo horário: 409 e não aprova', async () => {
    const { svc, linhas, facial } = build([
      reserva({ status: 'pendente' }),
      reserva({ id: 501, id_apartamento: 101, status: 'aprovado', hora_de: new Date(1970, 0, 1, 11, 0, 0), hora_ate: new Date(1970, 0, 1, 13, 0, 0) }),
    ]);
    const erro = await svc.updateStatusAgendamento(500, true, '', funcionario).catch((e) => e);
    expect(erro).toBeInstanceOf(ConflictException);
    expect(erro.message).toMatch(/outra reserva aprovada/i);
    expect(linhas[0].status).toBe('pendente');
    expect(facial.syncReservaArea).not.toHaveBeenCalled();
  });

  it('Aprovar 22:00–23:00 com outra aprovada 20:00–00:00 (fim do dia): 409', async () => {
    const { svc, linhas } = build([
      reserva({ status: 'pendente', hora_de: new Date(1970, 0, 1, 22, 0, 0), hora_ate: new Date(1970, 0, 1, 23, 0, 0) }),
      reserva({ id: 501, status: 'aprovado', hora_de: new Date(1970, 0, 1, 20, 0, 0), hora_ate: new Date(1970, 0, 1, 0, 0, 0) }),
    ]);
    await expect(svc.updateStatusAgendamento(500, true, '', funcionario)).rejects.toBeInstanceOf(ConflictException);
    expect(linhas[0].status).toBe('pendente');
  });

  it('Aprovar com reserva aprovada em horário vizinho (sem sobreposição) aprova', async () => {
    const { svc, linhas } = build([
      reserva({ status: 'pendente' }),
      reserva({ id: 501, status: 'aprovado', hora_de: new Date(1970, 0, 1, 12, 0, 0), hora_ate: new Date(1970, 0, 1, 14, 0, 0) }),
      reserva({ id: 502, status: 'cancelado', hora_de: new Date(1970, 0, 1, 10, 0, 0), hora_ate: new Date(1970, 0, 1, 12, 0, 0) }),
    ]);
    await expect(svc.updateStatusAgendamento(500, true, '', funcionario)).resolves.toEqual({ success: true });
    expect(linhas[0].status).toBe('aprovado');
  });

  it('caminho feliz: pendente → recusado grava o motivo e sincroniza o facial', async () => {
    const { svc, linhas, facial } = build([reserva({ status: 'pendente' })]);
    await svc.updateStatusAgendamento(500, false, 'Área reservada para obra', funcionario);
    expect(linhas[0].status).toBe('recusado');
    expect(linhas[0].motivo_recusa).toBe('Área reservada para obra');
    expect(facial.syncReservaArea).toHaveBeenCalledWith(500);
  });

  it('Cancelar reserva aprovada pela portaria vale', async () => {
    const { svc, linhas } = build([reserva({ status: 'aprovado' })]);
    await svc.updateStatusAgendamento(500, 'cancelado', 'Cancelada pela administração', funcionario);
    expect(linhas[0].status).toBe('cancelado');
  });

  it('morador cancela a PRÓPRIA reserva ainda pendente (o app oferece isso) — continua valendo', async () => {
    const { svc, linhas } = build([reserva({ status: 'pendente' })]);
    await svc.updateStatusAgendamento(500, 'cancelado', 'Cancelado pelo morador', morador);
    expect(linhas[0].status).toBe('cancelado');
  });

  it('status de destino desconhecido: 400', async () => {
    const { svc, linhas } = build([reserva({ status: 'aprovado' })]);
    await expect(svc.updateStatusAgendamento(500, 'pendente', '', funcionario)).rejects.toBeInstanceOf(BadRequestException);
    expect(linhas[0].status).toBe('aprovado');
  });
});
