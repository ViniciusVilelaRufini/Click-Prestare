import { BadRequestException } from '@nestjs/common';
import { VagasService } from './vagas.service';
import { MobileAuthService } from '../auth/mobile-auth.service';

/**
 * Liberar vaga para visitante (portaria-web e app) reaproveitava a última
 * visita da pessoa e zerava data_entrada/data_saida — o mesmo defeito já
 * corrigido em Solicitar/Liberar: numa visita encerrada, a passagem real
 * sumia do histórico; com a pessoa dentro, a entrada era apagada.
 *
 * E o app manda `inicio`/`fim` como `DateTime.toIso8601String()` de uma data
 * LOCAL (sem fuso). O servidor roda em UTC e `new Date()` lia 10:00 como
 * 10:00 UTC (07:00 em Brasília): a janela do visitante abria e fechava 3h
 * antes do combinado.
 */
describe('Vaga de visitante — histórico e fuso', () => {
  const original = process.env['PESSOAS_MIGRATION_ENABLED'];
  const tzOriginal = process.env.TZ;
  beforeAll(() => { process.env.TZ = 'UTC'; });
  afterAll(() => { process.env.TZ = tzOriginal; });
  afterEach(() => {
    if (original === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = original;
  });

  const entrou = new Date('2026-09-22T13:00:00Z');
  const saiu = new Date('2026-09-22T15:00:00Z');
  const APTO = { id: 10, id_condominio: 1, qtd_vagas: 2 };

  function prismaCom(visita: Record<string, unknown>) {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const visitas = new Map<number, any>();
    visitas.set(1000050, {
      id: 1000050, id_pessoa: 2000010, id_condominio: 1, id_apartamento: 10, user: 7,
      is_visitante: 1, is_prestador: 0, liberado: 0, bloqueado: 0, avisar: 1,
      codigo_acesso: null, tag_rfid: null, dias_semana: null, categorias: null,
      data_hora_inicio: null, data_hora_termino: null, data_entrada: null, data_saida: null,
      ...visita,
    });
    let seq = 1000051;
    const prisma: any = {
      isConnected: true,
      pessoas: {},
      vagas: {
        count: jest.fn(async () => 0),
        create: jest.fn(async ({ data }: any) => ({
          id: 99, ...data, veiculo: null, visitante: null, beneficiario: null,
          visita: { id: data.id_visita, pessoa: { nome: 'QA_SECURITY_20260923' } },
          titular: { nome: 'QA titular' },
        })),
      },
      veiculos: { count: jest.fn(async () => 0) },
      visitas: {
        findFirst: jest.fn(async ({ where }: any) => {
          if (where?.codigo_acesso) return null; // PIN livre
          return { ...visitas.get(1000050) };
        }),
        create: jest.fn(async ({ data }: any) => { const n = { id: seq++, ...data }; visitas.set(n.id, n); return n; }),
        update: jest.fn(async ({ where, data }: any) => { Object.assign(visitas.get(where.id), data); return visitas.get(where.id); }),
      },
      visitantes: { findFirst: jest.fn(async () => null) },
      moradores: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => [{ id: 5 }]) },
    };
    return { prisma, visitas };
  }

  function portaria(visita: Record<string, unknown>) {
    const { prisma, visitas } = prismaCom(visita);
    const svc = new VagasService(prisma, { syncVisitante: jest.fn(async () => ({})) } as any);
    jest.spyOn(svc as any, 'resolveApartamento').mockResolvedValue(APTO);
    jest.spyOn(svc as any, 'moradoresDoApto').mockResolvedValue([{ id: 5 }]);
    const liberar = (body: any = {}) =>
      svc.liberar(1, 10, { id_morador_titular: 5, tipo: 'visitante', id_visitante: 2000010, ...body });
    return { prisma, visitas, liberar };
  }

  function app(visita: Record<string, unknown>) {
    const { prisma, visitas } = prismaCom(visita);
    const svc = new MobileAuthService(prisma, {} as any, {} as any, {} as any, { syncVisitante: jest.fn(async () => ({})) } as any);
    jest.spyOn(svc as any, 'resolveMoradorApto').mockResolvedValue({ moradorId: 5, idCondominio: 1, apto: APTO });
    const liberar = (body: any = {}) =>
      svc.liberarVaga(7, 1, { tipo: 'visitante', id_visitante: 2000010, ...body });
    return { prisma, visitas, liberar };
  }

  describe.each([['portaria-web', portaria], ['app', app]])('%s', (_nome, montar) => {
    it('visita encerrada: abre visita nova e preserva a passagem antiga', async () => {
      const { prisma, visitas, liberar } = montar({ data_entrada: entrou, data_saida: saiu });
      await liberar();
      expect(visitas.get(1000050).data_entrada).toEqual(entrou);
      expect(visitas.get(1000050).data_saida).toEqual(saiu);
      expect(prisma.visitas.create).toHaveBeenCalledTimes(1);
      expect(prisma.vagas.create.mock.calls[0][0].data.id_visita).toBe(1000051);
      expect(visitas.get(1000051).liberado).toBe(1);
      expect(visitas.get(1000051).codigo_acesso).toMatch(/^\d{6}$/);
    });

    it('pessoa dentro do condomínio: recusa sem apagar a entrada', async () => {
      const { prisma, visitas, liberar } = montar({ data_entrada: entrou });
      await expect(liberar()).rejects.toBeInstanceOf(BadRequestException);
      expect(visitas.get(1000050).data_entrada).toEqual(entrou);
      expect(prisma.vagas.create).not.toHaveBeenCalled();
    });

    it('período sem fuso (como o app manda) é horário de Brasília', async () => {
      const { visitas, prisma, liberar } = montar({});
      await liberar({ inicio: '2026-09-23T10:00:00.000', fim: '2026-09-23T18:00:00.000' });
      expect(visitas.get(1000050).data_hora_inicio.toISOString()).toBe('2026-09-23T13:00:00.000Z');
      expect(visitas.get(1000050).data_hora_termino.toISOString()).toBe('2026-09-23T21:00:00.000Z');
      expect(prisma.vagas.create.mock.calls[0][0].data.inicio.toISOString()).toBe('2026-09-23T13:00:00.000Z');
    });

    it('período com fuso explícito é respeitado', async () => {
      const { visitas, liberar } = montar({});
      await liberar({ inicio: '2026-09-22T10:00:00.000Z', fim: '2026-09-22T18:00:00.000Z' });
      expect(visitas.get(1000050).data_hora_inicio.toISOString()).toBe('2026-09-22T10:00:00.000Z');
    });
  });
});
