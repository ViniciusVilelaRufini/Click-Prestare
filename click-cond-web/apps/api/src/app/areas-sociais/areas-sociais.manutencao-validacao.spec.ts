import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AreasSociaisService } from './areas-sociais.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

describe('AreasSociaisService — manutenção valida a janela antes de consultar conflito ou gravar', () => {
  const sindico: JwtPayload = { sub: 9, nome: 'Síndico Z', typeAccess: 'Sindico', is_sindico: 1 } as any;
  const base = {
    id: 900,
    id_area_social: 30,
    descricao: 'Pintura',
    data_inicio: '10/06/2026',
    hora_inicio: '09:00',
    data_termino: '10/06/2026',
    hora_termino: '18:00',
  };
  const MSG_FALTA = 'Informe a área, as datas e os horários da manutenção.';
  const MSG_INVALIDO = 'Data ou horário da manutenção inválido.';
  const MSG_ORDEM = 'O término da manutenção precisa ser depois do início.';

  function build() {
    const prisma: any = {
      isConnected: true,
      areas_Sociais: { findUnique: jest.fn(async () => ({ id: 30, id_condominio: 2, nome: 'Churrasqueira' })) },
      areas_Sociais_Manutencoes: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(async () => ({ id: 900, id_area_social: 30, area: { id_condominio: 2, nome: 'Churrasqueira' } })),
      },
      areas_Sociais_Agendamentos: { findMany: jest.fn(async () => []), update: jest.fn() },
      sindicos_Condominios: { findFirst: jest.fn(async () => ({ id: 1 })) },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    const svc = new AreasSociaisService(
      prisma,
      { sendPushNotification: jest.fn() } as any,
      { isDataUrl: () => false, uploadDataUrl: jest.fn() } as any,
      { syncReservaArea: jest.fn().mockResolvedValue({}) } as any,
      new TenantAccessService(prisma),
    );
    return { svc, prisma };
  }

  const casos: Array<[string, any, string]> = [
    ['sem data_inicio', { data_inicio: undefined }, MSG_FALTA],
    ['sem hora_termino', { hora_termino: '' }, MSG_FALTA],
    ['data inexistente', { data_inicio: '31/02/2026' }, MSG_INVALIDO],
    ['data fora do formato', { data_termino: '2026/06/10' }, MSG_INVALIDO],
    ['hora inválida', { hora_inicio: '25:00' }, MSG_INVALIDO],
    ['hora texto', { hora_termino: 'abc' }, MSG_INVALIDO],
    ['término antes do início (horas)', { hora_inicio: '18:00', hora_termino: '09:00' }, MSG_ORDEM],
    ['término antes do início (datas)', { data_termino: '09/06/2026' }, MSG_ORDEM],
    ['término igual ao início', { hora_termino: '09:00' }, MSG_ORDEM],
  ];

  describe.each(casos)('%s', (_nome, override, msg) => {
    it('insertManutencao -> 400 sem consultar conflito nem gravar', async () => {
      const { svc, prisma } = build();
      const p = svc.insertManutencao({ ...base, ...override }, sindico);
      await expect(p).rejects.toBeInstanceOf(BadRequestException);
      await expect(p).rejects.toThrow(msg);
      expect(prisma.areas_Sociais_Agendamentos.findMany).not.toHaveBeenCalled();
      expect(prisma.areas_Sociais_Manutencoes.create).not.toHaveBeenCalled();
      expect(prisma.areas_Sociais_Agendamentos.update).not.toHaveBeenCalled();
    });

    it('updateManutencao -> 400 sem consultar conflito nem gravar', async () => {
      const { svc, prisma } = build();
      const p = svc.updateManutencao({ ...base, ...override }, sindico);
      await expect(p).rejects.toBeInstanceOf(BadRequestException);
      await expect(p).rejects.toThrow(msg);
      expect(prisma.areas_Sociais_Agendamentos.findMany).not.toHaveBeenCalled();
      expect(prisma.areas_Sociais_Manutencoes.update).not.toHaveBeenCalled();
      expect(prisma.areas_Sociais_Agendamentos.update).not.toHaveBeenCalled();
    });
  });

  it('insertManutencao sem área -> 400 e nada consultado', async () => {
    const { svc, prisma } = build();
    await expect(svc.insertManutencao({ ...base, id_area_social: null }, sindico)).rejects.toThrow(MSG_FALTA);
    expect(prisma.areas_Sociais.findUnique).not.toHaveBeenCalled();
    expect(prisma.areas_Sociais_Manutencoes.create).not.toHaveBeenCalled();
  });

  it('janela válida segue gravando', async () => {
    const { svc, prisma } = build();
    await svc.insertManutencao(base, sindico);
    await svc.updateManutencao(base, sindico);
    expect(prisma.areas_Sociais_Manutencoes.create).toHaveBeenCalledTimes(1);
    expect(prisma.areas_Sociais_Manutencoes.update).toHaveBeenCalledTimes(1);
  });

  it.each(['abc', '0', '-3', '1.5'])('insertManutencao com id_area_social %j -> 400 sem consultar a área', async (id) => {
    const { svc, prisma } = build();
    const p = svc.insertManutencao({ ...base, id_area_social: id }, sindico);
    await expect(p).rejects.toBeInstanceOf(BadRequestException);
    await expect(p).rejects.toThrow(MSG_FALTA);
    expect(prisma.areas_Sociais.findUnique).not.toHaveBeenCalled();
    expect(prisma.areas_Sociais_Manutencoes.create).not.toHaveBeenCalled();
  });

  it.each([
    ['ISO com espaço (Dart)', '2026-06-10 00:00:00.000', '1970-01-01 09:00:00.000', '1970-01-01 18:00:00.000'],
    ['ISO com T', '2026-06-10T00:00:00', '1970-01-01T09:00:00', '1970-01-01T18:00:00'],
    ['ISO só data + HH:mm:ss', '2026-06-10', '09:00:00', '18:00:00'],
  ])('formato %s grava como dd/MM/yyyy', async (_n, data, hi, ht) => {
    const { svc, prisma } = build();
    await svc.insertManutencao({ ...base, data_inicio: data, data_termino: data, hora_inicio: hi, hora_termino: ht }, sindico);
    await svc.updateManutencao({ ...base, data_inicio: data, data_termino: data, hora_inicio: hi, hora_termino: ht }, sindico);
    const esperado = (d: any) => {
      expect([d.data_inicio.getFullYear(), d.data_inicio.getMonth(), d.data_inicio.getDate()]).toEqual([2026, 5, 10]);
      expect([d.hora_inicio.getHours(), d.hora_inicio.getMinutes()]).toEqual([9, 0]);
      expect([d.hora_termino.getHours(), d.hora_termino.getMinutes()]).toEqual([18, 0]);
    };
    esperado(prisma.areas_Sociais_Manutencoes.create.mock.calls[0][0].data);
    esperado(prisma.areas_Sociais_Manutencoes.update.mock.calls[0][0].data);
  });

  it('data ISO impossível (2026-02-31) segue recusada', async () => {
    const { svc } = build();
    await expect(svc.insertManutencao({ ...base, data_inicio: '2026-02-31 00:00:00.000' }, sindico)).rejects.toThrow(MSG_INVALIDO);
  });

  it('updateManutencao: funcionário sem a flag manutencoes_programadas -> 403 e nada gravado', async () => {
    const { svc, prisma } = build();
    prisma.funcionarios = { findFirst: jest.fn(async () => ({ manutencoes_programadas: 0 })) };
    const func: JwtPayload = { sub: 5, nome: 'F', typeAccess: 'Funcionario', user: { id: 5 } } as any;
    await expect(svc.updateManutencao(base, func)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.areas_Sociais_Manutencoes.update).not.toHaveBeenCalled();
    expect(prisma.areas_Sociais_Agendamentos.update).not.toHaveBeenCalled();
  });
});
