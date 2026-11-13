import { VagasService } from './vagas.service';
import { MobileAuthService } from '../auth/mobile-auth.service';

/**
 * Vaga cedida a visitante tem prazo (`fim`), mas nada a encerrava: passado o
 * fim, a linha seguia `ativo = 1` e continuava ocupando a vaga do apartamento
 * (o porteiro não conseguia liberar outra). Agora a vigência é decidida na
 * leitura — sem job e sem coluna nova: visitante com `fim` no passado não
 * conta como vaga ocupada, e a listagem marca a vaga como vencida para o
 * porteiro revogar.
 */
const AGORA = new Date('2026-11-13T15:00:00.000Z');
const ONTEM = new Date('2026-11-12T15:00:00.000Z');
const AMANHA = new Date('2026-11-14T15:00:00.000Z');

/** Avalia o `where` que os services mandam para `Vagas` (só as formas usadas). */
function casaVaga(v: any, where: any): boolean {
  for (const [k, cond] of Object.entries(where ?? {})) {
    if (k === 'OR') {
      if (!(cond as any[]).some((c) => casaVaga(v, c))) return false;
      continue;
    }
    if (cond === null) {
      if (v[k] != null) return false;
    } else if (typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as any;
      if ('not' in c && v[k] === c.not) return false;
      if ('gt' in c && !(v[k] != null && v[k] > c.gt)) return false;
      if ('in' in c && !c.in.includes(v[k])) return false;
    } else if (v[k] !== cond) {
      return false;
    }
  }
  return true;
}

function prismaComVagas(vagas: any[]) {
  return {
    isConnected: true,
    vagas: {
      count: jest.fn(async ({ where }: any) => vagas.filter((v) => casaVaga(v, where)).length),
      findMany: jest.fn(async ({ where }: any) => vagas.filter((v) => casaVaga(v, where))),
      create: jest.fn(async ({ data }: any) => ({ id: 99, ...data, titular: { nome: 'Titular' }, beneficiario: { nome: 'Inquilino' } })),
    },
    veiculos: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
  } as any;
}

const vagaVisitanteVencida = {
  id: 7, id_apartamento: 10, ativo: 1, tipo_ocupacao: 'visitante', id_visitante: 3, id_visita: null,
  inicio: new Date('2026-11-10T12:00:00.000Z'), fim: ONTEM, titular: { nome: 'Titular' }, visitante: { nome: 'Visitante' },
};

describe('VagasService — vaga de visitante vencida', () => {
  beforeAll(() => jest.useFakeTimers({ advanceTimers: true }).setSystemTime(AGORA));
  afterAll(() => jest.useRealTimers());

  const APTO = { id: 10, id_condominio: 1, bloco: 'A', apto: '101', qtd_vagas: 1 };
  const MORADORES = [{ id: 5, nome: 'Titular', tipo: 'Morador' }, { id: 6, nome: 'Inquilino', tipo: 'Inquilino' }];

  function build(vagas: any[]) {
    const prisma = prismaComVagas(vagas);
    const svc = new VagasService(prisma, { syncVisitante: jest.fn(async () => ({})) } as any);
    jest.spyOn(svc as any, 'resolveApartamento').mockResolvedValue(APTO);
    jest.spyOn(svc as any, 'moradoresDoApto').mockResolvedValue(MORADORES);
    return { svc, prisma };
  }

  it('liberar: a vaga vencida não ocupa a única vaga do apartamento', async () => {
    const { svc, prisma } = build([vagaVisitanteVencida]);
    await svc.liberar(1, 10, { id_morador_titular: 5, tipo: 'inquilino', id_morador_beneficiario: 6 });
    expect(prisma.vagas.create).toHaveBeenCalled();
  });

  it('liberar: vaga de visitante ainda dentro do prazo continua ocupando', async () => {
    const { svc, prisma } = build([{ ...vagaVisitanteVencida, fim: AMANHA }]);
    await expect(
      svc.liberar(1, 10, { id_morador_titular: 5, tipo: 'inquilino', id_morador_beneficiario: 6 }),
    ).rejects.toThrow('Não há vagas livres neste apartamento.');
  });

  it('list: a vencida aparece marcada (para revogar) e não conta em "ocupadas"', async () => {
    const { svc } = build([vagaVisitanteVencida, { ...vagaVisitanteVencida, id: 8, fim: AMANHA }]);
    const r = await svc.list(1, 10);
    expect(r.ocupadas).toBe(1);
    expect(r.vagas.find((v: any) => v.id === 7)).toMatchObject({ vencida: true });
    expect(r.vagas.find((v: any) => v.id === 8)).toMatchObject({ vencida: false });
  });
});

describe('MobileAuthService.liberarVaga — vaga de visitante vencida não ocupa', () => {
  beforeAll(() => jest.useFakeTimers({ advanceTimers: true }).setSystemTime(AGORA));
  afterAll(() => jest.useRealTimers());

  it('libera a vaga quando a única ocupada é de visitante vencida', async () => {
    const APTO = { id: 10, id_condominio: 1, bloco: 'A', apto: '101', qtd_vagas: 1 };
    const prisma = prismaComVagas([vagaVisitanteVencida]);
    prisma.moradores = {
      findMany: jest.fn(async () => [{ id: 5 }, { id: 6 }]),
      findFirst: jest.fn(async () => ({ id: 6, id_condominio: 1, bloco: 'A', apartamento: '101' })),
    };
    const svc = new MobileAuthService(prisma, {} as any, {} as any, {} as any, { syncVisitante: jest.fn() } as any);
    jest.spyOn(svc as any, 'resolveMoradorApto').mockResolvedValue({ moradorId: 5, idCondominio: 1, apto: APTO });
    await svc.liberarVaga(1, 1, { tipo: 'inquilino', id_morador_beneficiario: 6 });
    expect(prisma.vagas.create).toHaveBeenCalled();
  });
});
