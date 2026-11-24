import { BadRequestException, ConflictException } from '@nestjs/common';
import { AreasSociaisService } from './areas-sociais.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * D2 (varredura 24/11): reserva de área sem trava. Criação e aprovação
 * conferiam o conflito de horário em memória: dois pedidos (ou duas
 * aprovações) juntos no mesmo horário liam o dia livre e os dois gravavam.
 * Agora conferir + gravar roda sob o lock `area:<id>:<dia>` (GET_LOCK).
 *
 * O banco falso guarda as linhas e devolve o que já foi gravado; o GET_LOCK
 * falso tem fila por nome, como o MySQL entre sessões. Cada leitura cede a vez
 * (setImmediate) para as duas chamadas se intercalarem como no servidor.
 */
const area = {
  id: 30,
  id_condominio: 2,
  nome: 'Salão',
  precisa_autorizacao: 0,
  limite_mensal_apto: 0,
  capacidade: 0,
};
const sindico: JwtPayload = { sub: 1, nome: 'Síndico', id_condominio: 2, typeAccess: 'Sindico' };
const cede = () => new Promise((r) => setImmediate(r));

function build(linhasIniciais: any[] = []) {
  const linhas: any[] = linhasIniciais.map((l) => ({ ...l }));
  const casa = (l: any, where: any) =>
    (where.id === undefined || l.id === where.id) &&
    (where.id_area_social === undefined || l.id_area_social === where.id_area_social) &&
    (!(where.data instanceof Date) || l.data.getTime() === where.data.getTime()) &&
    (where.status === undefined ||
      (typeof where.status === 'string' ? l.status === where.status : where.status.in.includes(l.status))) &&
    (where.NOT?.id === undefined || l.id !== where.NOT.id);

  const donos = new Map<string, Promise<void>>();
  const soltar = new Map<string, () => void>();
  const nomesDoLock: string[] = [];
  const prisma: any = {
    isConnected: true,
    areas_Sociais: { findUnique: jest.fn(async () => ({ ...area })) },
    areas_Sociais_Agendamentos: {
      findMany: jest.fn(async ({ where }: any) => {
        const r = linhas.filter((l) => casa(l, where)).map((l) => ({ ...l }));
        await cede();
        return r;
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        const l = linhas.find((x) => x.id === where.id);
        return l ? { ...l, area: { id_condominio: 2 }, user: null } : null;
      }),
      create: jest.fn(async ({ data }: any) => {
        await cede();
        const nova = { id: 500 + linhas.length, ...data };
        linhas.push(nova);
        return nova;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        await cede();
        const alvo = linhas.filter((l) => casa(l, where));
        alvo.forEach((l) => Object.assign(l, data));
        return { count: alvo.length };
      }),
    },
    areas_Sociais_Manutencoes: { findMany: jest.fn(async () => []) },
    apartamentos: { findUnique: jest.fn(async () => ({ id_condominio: 2 })) },
    apartamentos_Users: { findFirst: jest.fn(async () => ({ id_user: 5 })), findMany: jest.fn(async () => []) },
    $transaction: jest.fn(async (fn: any) =>
      fn({
        $queryRaw: async (strings: TemplateStringsArray, nome: string) => {
          const sql = strings.join('?');
          if (sql.includes('GET_LOCK')) {
            nomesDoLock.push(nome);
            while (donos.has(nome)) await donos.get(nome);
            let s!: () => void;
            donos.set(nome, new Promise<void>((r) => (s = r)));
            soltar.set(nome, s);
            return [{ ok: 1 }];
          }
          if (sql.includes('RELEASE_LOCK')) {
            donos.delete(nome);
            soltar.get(nome)?.();
          }
          return [{ ok: 1 }];
        },
      }),
    ),
  };
  const facial: any = { syncReservaArea: jest.fn().mockResolvedValue({}) };
  const tenant = new TenantAccessService(prisma);
  jest.spyOn(tenant, 'assertEntidade').mockResolvedValue(undefined as any);
  jest.spyOn(tenant, 'assertPermissaoFuncionario').mockResolvedValue(undefined as any);
  const svc = new AreasSociaisService(prisma, { sendPushNotification: jest.fn() } as any, { isDataUrl: () => false } as any, facial, tenant);
  return { svc, prisma, linhas, nomesDoLock };
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
  jest.setSystemTime(new Date('2026-06-01T12:00:00.000Z'));
});
afterEach(() => jest.useRealTimers());

describe('D2 — criação de reserva sob lock por área e dia', () => {
  const pedido = (apto: number) => ({
    id_area_social: 30,
    id_apartamento: apto,
    data: '10/06/2026',
    horaDe: '18:00',
    horaAte: '22:00',
    agendarPeloSindico: true,
  });

  it('dois pedidos juntos no mesmo horário: um grava, o outro recebe o conflito', async () => {
    const { svc, prisma, nomesDoLock } = build();
    const resultados = await Promise.allSettled([
      svc.insertAgendamento(pedido(100), null, 'Sindico', sindico),
      svc.insertAgendamento(pedido(101), null, 'Sindico', sindico),
    ]);
    expect(resultados.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const recusa = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(recusa.reason).toBeInstanceOf(BadRequestException);
    expect(recusa.reason.message).toMatch(/conflita com o horário/);
    expect(prisma.areas_Sociais_Agendamentos.create).toHaveBeenCalledTimes(1);
    expect(nomesDoLock).toEqual(['prestare:area:30:2026-06-10', 'prestare:area:30:2026-06-10']);
  });

  it('dias diferentes não disputam o mesmo lock', async () => {
    const { svc, nomesDoLock } = build();
    await svc.insertAgendamento(pedido(100), null, 'Sindico', sindico);
    await svc.insertAgendamento({ ...pedido(101), data: '11/06/2026' }, null, 'Sindico', sindico);
    expect(nomesDoLock).toEqual(['prestare:area:30:2026-06-10', 'prestare:area:30:2026-06-11']);
  });
});

describe('D2 — aprovação de reserva sob o mesmo lock', () => {
  const pendente = (id: number, apto: number) => ({
    id,
    id_area_social: 30,
    id_apartamento: apto,
    id_user: 5,
    data: new Date('2026-06-10T00:00:00.000Z'),
    hora_de: new Date(1970, 0, 1, 18, 0, 0),
    hora_ate: new Date(1970, 0, 1, 22, 0, 0),
    status: 'pendente',
  });

  it('duas aprovações juntas no mesmo horário: só uma vira aprovada', async () => {
    const { svc, linhas, nomesDoLock } = build([pendente(1, 100), pendente(2, 101)]);
    const resultados = await Promise.allSettled([
      svc.updateStatusAgendamento(1, 'aprovado', '', sindico),
      svc.updateStatusAgendamento(2, 'aprovado', '', sindico),
    ]);
    expect(resultados.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const recusa = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(recusa.reason).toBeInstanceOf(ConflictException);
    expect(recusa.reason.message).toMatch(/outra reserva aprovada neste horário/);
    expect(linhas.filter((l) => l.status === 'aprovado')).toHaveLength(1);
    expect(nomesDoLock).toEqual(['prestare:area:30:2026-06-10', 'prestare:area:30:2026-06-10']);
  });

  it('recusar não pega o lock (só libera horário)', async () => {
    const { svc, nomesDoLock } = build([pendente(1, 100)]);
    await svc.updateStatusAgendamento(1, 'recusado', 'lotado', sindico);
    expect(nomesDoLock).toEqual([]);
  });
});

describe('Sync facial de cancelamentos em massa (fix round 1)', () => {
  /** Facial falso que mede quantos syncs correm ao mesmo tempo. */
  function facialMedido() {
    let emCurso = 0;
    let pico = 0;
    const facial: any = {
      syncReservaArea: jest.fn(async () => {
        emCurso++;
        pico = Math.max(pico, emCurso);
        await cede();
        emCurso--;
        return {};
      }),
    };
    return { facial, pico: () => pico };
  }
  const atingida = (i: number, apto = 100 + i) => ({
    id: i + 1,
    id_area_social: 30,
    id_apartamento: apto,
    data: new Date('2026-06-10T00:00:00.000Z'),
    hora_de: new Date(1970, 0, 1, 18, 0, 0),
    hora_ate: new Date(1970, 0, 1, 22, 0, 0),
    user: null,
  });
  const esperaTerminar = async (fn: () => boolean) => {
    for (let i = 0; i < 500 && !fn(); i++) await cede();
  };

  it('manutenção com 30 reservas atingidas: um sync por vez, um por (área, apto), e todos rodam', async () => {
    const { svc } = build();
    const { facial, pico } = facialMedido();
    (svc as any).facial = facial;
    // 30 reservas; a 30ª é do mesmo apto da 1ª (dedupe).
    const conflitantes = [...Array.from({ length: 29 }, (_, i) => atingida(i)), atingida(29, 100)];
    await (svc as any).notificarCancelamentosPorManutencao(conflitantes, 'Salão');
    await esperaTerminar(() => facial.syncReservaArea.mock.calls.length === 29 && pico() >= 1);
    await cede();
    expect(facial.syncReservaArea).toHaveBeenCalledTimes(29);
    expect(pico()).toBe(1);
  });

  it('falta de confirmação: syncs em sequência e deduplicados por (área, apto)', async () => {
    const { svc, prisma } = build();
    const { facial, pico } = facialMedido();
    (svc as any).facial = facial;
    const candidatos = [
      ...Array.from({ length: 5 }, (_, i) => ({ ...atingida(i), area: { nome: 'Salão' } })),
      { ...atingida(5, 100), area: { nome: 'Salão' } },
    ];
    prisma.areas_Sociais_Agendamentos.findMany = jest.fn(async () => candidatos);
    prisma.areas_Sociais_Agendamentos.update = jest.fn(async () => ({}));
    await (svc as any).cancelarReservasNaoConfirmadas(new Date('2026-06-11T12:00:00.000Z'));
    await esperaTerminar(() => facial.syncReservaArea.mock.calls.length === 5);
    await cede();
    expect(prisma.areas_Sociais_Agendamentos.update).toHaveBeenCalledTimes(6);
    expect(facial.syncReservaArea).toHaveBeenCalledTimes(5);
    expect(pico()).toBe(1);
  });
});
