import { BadRequestException } from '@nestjs/common';
import { AreasSociaisService } from './areas-sociais.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Cobre os três defeitos do cálculo de `horarios_livres` (get) e a checagem
 * de manutenção em `insertAgendamento`:
 *  1. hoje não era ofertado (o laço pulava direto pra amanhã);
 *  2. reserva 'recusado' continuava removendo o horário da tela;
 *  3. janela de manutenção não era considerada em lugar nenhum.
 *
 * Cobre também o fuso: o processo roda em UTC (como o Railway) e as asserções
 * são escritas no relógio de Brasília (UTC−3), que é o do morador.
 *
 * "Agora" é fixado via fake timers em 10/06/2026 12:00 UTC = 09:00 BRT
 * (quarta-feira) para as datas ficarem determinísticas.
 */
describe('AreasSociaisService — horários livres (hoje, status, manutenção)', () => {
  const areaCond2 = {
    id: 30,
    id_condominio: 2,
    precisa_autorizacao: 0,
    imagem: '',
    capacidade: 10,
    precisa_agendar: 1,
    precisa_pagamento: 0,
    // Todo dia da semana libera 10:00-14:00 e 15:00-22:00.
    horarios: JSON.stringify(
      Array.from({ length: 7 }).map(() => ({
        horarios: [
          { horarioDe: '10:00', horarioAte: '14:00' },
          { horarioDe: '15:00', horarioAte: '22:00' },
        ],
      })),
    ),
  };

  const funcionarioCond2: JwtPayload = { sub: 6, nome: 'Porteiro Y', id_condominio: 2, typeAccess: 'Funcionario' };

  function build(opts: { agendamentos?: any[]; manutencoes?: any[]; horarios?: string } = {}) {
    const prisma: any = {
      isConnected: true,
      areas_Sociais: {
        findUnique: jest.fn(async ({ where }: any) =>
          where.id === 30 ? { ...areaCond2, ...(opts.horarios ? { horarios: opts.horarios } : {}) } : null,
        ),
      },
      areas_Sociais_Agendamentos: {
        findMany: jest.fn(async () => opts.agendamentos ?? []),
        create: jest.fn(async () => ({ id: 500, status: 'aprovado' })),
      },
      areas_Sociais_Manutencoes: {
        findMany: jest.fn(async () => opts.manutencoes ?? []),
      },
      facial_Devices: {
        count: jest.fn(async () => 0),
      },
      $queryRaw: jest.fn(async () => []),
    };
    const notifications: any = { sendPushNotification: jest.fn() };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const facial: any = { syncReservaArea: jest.fn().mockResolvedValue({}) };
    const tenant = new TenantAccessService(prisma);
    const svc = new AreasSociaisService(prisma, notifications, storage, facial, tenant);
    return { svc, prisma };
  }

  // Helper: agendamento cru como o Prisma devolveria (Date + campos de hora).
  function agendamentoDb(overrides: Partial<any> = {}) {
    return {
      id: 1,
      status: 'aprovado',
      apartamento: { bloco: 'A', apto: '101' },
      data: new Date(2026, 5, 10),
      hora_de: new Date(1970, 0, 1, 10, 0, 0),
      hora_ate: new Date(1970, 0, 1, 14, 0, 0),
      ...overrides,
    };
  }

  function manutencaoDb(overrides: Partial<any> = {}) {
    return {
      id: 1,
      descricao: 'Pintura',
      data_inicio: new Date(2026, 5, 10),
      hora_inicio: new Date(1970, 0, 1, 0, 0, 0),
      data_termino: new Date(2026, 5, 10),
      hora_termino: new Date(1970, 0, 1, 23, 59, 0),
      ...overrides,
    };
  }

  // O processo dos testes roda em UTC (TZ fixado em jest.config.cts), igual ao
  // Railway — é assim que estes testes enxergam o fuso do morador.
  beforeEach(() => {
    // Quarta-feira 10/06/2026 12:00 UTC = 09:00 BRT, antes do bloco 10:00-14:00.
    jest.useFakeTimers({ advanceTimers: false }).setSystemTime(new Date(Date.UTC(2026, 5, 10, 12, 0, 0)));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('inclusão de hoje', () => {
    it('hoje aparece em horarios_livres quando ainda há bloco futuro (15:00-22:00)', async () => {
      const { svc } = build();
      const resultado = await svc.get(2, 30, funcionarioCond2);
      const hoje = resultado.horarios_livres['10/06/2026'];
      expect(hoje).toBeDefined();
      expect(hoje).toContainEqual({ horarioDe: '15:00', horarioAte: '22:00' });
    });

    it('bloco de hoje que já terminou some quando a hora avança', async () => {
      // Move "agora" pra depois do fim do primeiro bloco: 14:30 BRT (17:30 UTC).
      jest.setSystemTime(new Date(Date.UTC(2026, 5, 10, 17, 30, 0)));
      const { svc } = build();
      const resultado = await svc.get(2, 30, funcionarioCond2);
      const hoje = resultado.horarios_livres['10/06/2026'];
      expect(hoje).toBeDefined();
      expect(hoje).not.toContainEqual({ horarioDe: '10:00', horarioAte: '14:00' });
      expect(hoje).toContainEqual({ horarioDe: '15:00', horarioAte: '22:00' });
    });

    it('quando todos os blocos de hoje já terminaram, a data nem aparece', async () => {
      // 22:00 BRT de 10/06 = 01:00 UTC de 11/06 — os dois blocos já fecharam.
      jest.setSystemTime(new Date(Date.UTC(2026, 5, 11, 1, 0, 0)));
      const { svc } = build();
      const resultado = await svc.get(2, 30, funcionarioCond2);
      expect(resultado.horarios_livres['10/06/2026']).toBeUndefined();
    });
  });

  describe('fuso do condomínio (servidor em UTC, morador em BRT)', () => {
    it('às 11:30 BRT (14:30 UTC) o bloco 12:00-14:00 de hoje ainda é ofertado', async () => {
      jest.setSystemTime(new Date(Date.UTC(2026, 5, 10, 14, 30, 0)));
      const { svc } = build({
        horarios: JSON.stringify(
          Array.from({ length: 7 }).map(() => ({
            horarios: [{ horarioDe: '12:00', horarioAte: '14:00' }],
          })),
        ),
      });
      const resultado = await svc.get(2, 30, funcionarioCond2);
      // Faltam 30 min para o bloco começar — com o relógio do servidor ele
      // sumia como "vencido".
      expect(resultado.horarios_livres['10/06/2026']).toContainEqual({ horarioDe: '12:00', horarioAte: '14:00' });
    });

    it('às 21:30 BRT (00:30 UTC do dia seguinte) o hoje do morador continua na lista', async () => {
      jest.setSystemTime(new Date(Date.UTC(2026, 5, 11, 0, 30, 0)));
      const { svc } = build();
      const resultado = await svc.get(2, 30, funcionarioCond2);
      // A data brasileira ainda é 10/06 — não pode ter pulado para 11/06.
      expect(resultado.horarios_livres['10/06/2026']).toContainEqual({ horarioDe: '15:00', horarioAte: '22:00' });
      expect(Object.keys(resultado.horarios_livres)[0]).toBe('10/06/2026');
    });
  });

  describe('filtro por status', () => {
    it("agendamento 'recusado' NÃO remove o horário", async () => {
      const { svc } = build({
        agendamentos: [agendamentoDb({ status: 'recusado' })],
      });
      const resultado = await svc.get(2, 30, funcionarioCond2);
      expect(resultado.horarios_livres['10/06/2026']).toContainEqual({ horarioDe: '10:00', horarioAte: '14:00' });
      // A agenda (histórico) continua mostrando a reserva recusada.
      expect(resultado.agendamentos).toHaveLength(1);
      expect(resultado.agendamentos[0].status).toBe('recusado');
    });

    it("agendamento 'aprovado' remove o horário", async () => {
      const { svc } = build({
        agendamentos: [agendamentoDb({ status: 'aprovado' })],
      });
      const resultado = await svc.get(2, 30, funcionarioCond2);
      expect(resultado.horarios_livres['10/06/2026']).not.toContainEqual({ horarioDe: '10:00', horarioAte: '14:00' });
    });

    it("agendamento 'pendente' remove o horário", async () => {
      const { svc } = build({
        agendamentos: [agendamentoDb({ status: 'pendente' })],
      });
      const resultado = await svc.get(2, 30, funcionarioCond2);
      expect(resultado.horarios_livres['10/06/2026']).not.toContainEqual({ horarioDe: '10:00', horarioAte: '14:00' });
    });
  });

  describe('subtração de manutenção', () => {
    it('janela de manutenção parcial remove só o bloco que ela intersecta', async () => {
      const { svc } = build({
        // Manutenção 09:00-14:30 hoje: intersecta o bloco 10:00-14:00 inteiro,
        // mas não o 15:00-22:00.
        manutencoes: [
          manutencaoDb({
            hora_inicio: new Date(1970, 0, 1, 9, 0, 0),
            hora_termino: new Date(1970, 0, 1, 14, 30, 0),
          }),
        ],
      });
      const resultado = await svc.get(2, 30, funcionarioCond2);
      const hoje = resultado.horarios_livres['10/06/2026'];
      expect(hoje).not.toContainEqual({ horarioDe: '10:00', horarioAte: '14:00' });
      expect(hoje).toContainEqual({ horarioDe: '15:00', horarioAte: '22:00' });
      expect(resultado.manutencoes).toEqual([
        {
          id: 1,
          descricao: 'Pintura',
          data_inicio: '10/06/2026',
          hora_inicio: '09:00',
          data_termino: '10/06/2026',
          hora_termino: '14:30',
        },
      ]);
    });

    it('manutenção que atravessa dias remove blocos em todos os dias cobertos', async () => {
      const { svc } = build({
        manutencoes: [
          manutencaoDb({
            data_inicio: new Date(2026, 5, 10),
            hora_inicio: new Date(1970, 0, 1, 20, 0, 0),
            data_termino: new Date(2026, 5, 11),
            hora_termino: new Date(1970, 0, 1, 11, 0, 0),
          }),
        ],
      });
      const resultado = await svc.get(2, 30, funcionarioCond2);
      // Dia 10: só o bloco 15:00-22:00 intersecta (janela começa às 20:00).
      expect(resultado.horarios_livres['10/06/2026']).not.toContainEqual({ horarioDe: '15:00', horarioAte: '22:00' });
      expect(resultado.horarios_livres['10/06/2026']).toContainEqual({ horarioDe: '10:00', horarioAte: '14:00' });
      // Dia 11: o bloco 10:00-14:00 intersecta (janela termina às 11:00).
      expect(resultado.horarios_livres['11/06/2026']).not.toContainEqual({ horarioDe: '10:00', horarioAte: '14:00' });
      expect(resultado.horarios_livres['11/06/2026']).toContainEqual({ horarioDe: '15:00', horarioAte: '22:00' });
    });

    it('bloco que só toca a borda da manutenção NÃO colide (inequação estrita)', async () => {
      const { svc } = build({
        // Manutenção termina exatamente quando o segundo bloco começa (15:00).
        manutencoes: [
          manutencaoDb({
            hora_inicio: new Date(1970, 0, 1, 14, 0, 0),
            hora_termino: new Date(1970, 0, 1, 15, 0, 0),
          }),
        ],
      });
      const resultado = await svc.get(2, 30, funcionarioCond2);
      const hoje = resultado.horarios_livres['10/06/2026'];
      // Bloco 10:00-14:00 termina quando a manutenção começa: não colide.
      expect(hoje).toContainEqual({ horarioDe: '10:00', horarioAte: '14:00' });
      // Bloco 15:00-22:00 começa quando a manutenção termina: não colide.
      expect(hoje).toContainEqual({ horarioDe: '15:00', horarioAte: '22:00' });
    });

    it('manutenção já terminada não aparece em manutencoes nem afeta horarios_livres', async () => {
      const { svc } = build({
        manutencoes: [
          manutencaoDb({
            data_inicio: new Date(2026, 5, 1),
            data_termino: new Date(2026, 5, 1),
            hora_termino: new Date(1970, 0, 1, 23, 59, 0),
          }),
        ],
      });
      const resultado = await svc.get(2, 30, funcionarioCond2);
      expect(resultado.manutencoes).toEqual([]);
      expect(resultado.horarios_livres['10/06/2026']).toContainEqual({ horarioDe: '10:00', horarioAte: '14:00' });
    });

    it('manutenção sem data_inicio é ignorada (não apaga a agenda inteira)', async () => {
      const { svc } = build({
        manutencoes: [
          manutencaoDb({ data_inicio: null, data_termino: new Date(2026, 6, 31) }),
        ],
      });
      const resultado = await svc.get(2, 30, funcionarioCond2);
      expect(resultado.manutencoes).toEqual([]);
      expect(resultado.horarios_livres['10/06/2026']).toContainEqual({ horarioDe: '10:00', horarioAte: '14:00' });
      expect(resultado.horarios_livres['15/06/2026']).toContainEqual({ horarioDe: '15:00', horarioAte: '22:00' });
    });
  });

  describe('insertAgendamento recusa horário em manutenção', () => {
    const agendamentoBase = {
      id_area_social: 30,
      id_apartamento: 100,
      data: '10/06/2026',
      horaDe: '10:00',
      horaAte: '11:00',
    };

    it('lança BadRequestException quando o horário solicitado cai em manutenção', async () => {
      const { svc, prisma } = build({
        manutencoes: [
          manutencaoDb({
            hora_inicio: new Date(1970, 0, 1, 9, 0, 0),
            hora_termino: new Date(1970, 0, 1, 12, 0, 0),
          }),
        ],
      });
      await expect(
        svc.insertAgendamento(agendamentoBase, 6, 'Funcionario', funcionarioCond2),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.areas_Sociais_Agendamentos.create).not.toHaveBeenCalled();
    });

    it('PERMITE reserva fora da janela de manutenção', async () => {
      const { svc, prisma } = build({
        manutencoes: [
          manutencaoDb({
            hora_inicio: new Date(1970, 0, 1, 12, 0, 0),
            hora_termino: new Date(1970, 0, 1, 13, 0, 0),
          }),
        ],
      });
      await svc.insertAgendamento(agendamentoBase, 6, 'Funcionario', funcionarioCond2);
      expect(prisma.areas_Sociais_Agendamentos.create).toHaveBeenCalled();
    });

    it('manutenção sem data_inicio não bloqueia a reserva', async () => {
      const { svc, prisma } = build({
        manutencoes: [
          manutencaoDb({ data_inicio: null, data_termino: new Date(2026, 6, 31) }),
        ],
      });
      await svc.insertAgendamento(agendamentoBase, 6, 'Funcionario', funcionarioCond2);
      expect(prisma.areas_Sociais_Agendamentos.create).toHaveBeenCalled();
    });
  });
});
