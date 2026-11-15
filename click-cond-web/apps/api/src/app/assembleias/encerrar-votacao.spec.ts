import { AssembleiasController } from './assembleias.controller';
import { AssembleiasService } from './assembleias.service';

/**
 * Rodada 5 (2.4): "Encerrar" grava a hora em `encerrada_em` — antes gravava
 * `data_termino = ontem`, o que fazia o período exibido mentir ("13/11 a
 * 12/11") e dependia do relógio. O término exibido só é puxado para hoje
 * quando estava no futuro. Encerrar de novo: sucesso sem regravar. Não há
 * reabrir. calcStatusInt dá 2 com `encerrada_em` e continua tratando as
 * linhas antigas gravadas com término = ontem.
 */
describe('finishVotacao — encerrada_em', () => {
  const sindico: any = { sub: 1, typeAccess: 'Sindico', user: { id: 1 } };
  afterEach(() => jest.useRealTimers());

  function build(atual: any = {}) {
    const prisma: any = {
      isConnected: true,
      votacoes: {
        findUnique: jest.fn(async () => ({
          id_condominio: 1, encerrada_em: null, data_termino: new Date('2026-11-30T00:00:00Z'), ...atual,
        })),
        update: jest.fn(async () => ({})),
        // Mapa da votação, lido para congelar os votos antigos (sem votos aqui).
        findMany: jest.fn(async () => []),
      },
    };
    prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
    // Travas (SELECT ... FOR UPDATE / FOR SHARE): assembleia não finalizada; a
    // votação vem do findUnique do próprio fake.
    prisma.$queryRaw = jest.fn(async (strings: TemplateStringsArray, ...vals: unknown[]) => {
      const sql = strings.join('?');
      if (/FROM Assembleias/.test(sql)) return [{ id: vals[0], id_condominio: 1, finalizada_em: null }];
      if (/FROM Votacoes WHERE id =/.test(sql)) {
        const v = await prisma.votacoes?.findUnique?.({ where: { id: vals[0] } });
        return v ? [{ id: vals[0], id_assembleia: null, encerrada_em: null, data_inicio: null, data_termino: null, ...v }] : [];
      }
      return [];
    });
    const tenant: any = { assertEntidade: jest.fn(async () => undefined) };
    return { svc: new AssembleiasService(prisma, {} as any, tenant), prisma };
  }

  it('grava encerrada_em = agora e puxa o término futuro para hoje (Brasília)', async () => {
    // 13/11 01:30 UTC = 12/11 22:30 em Brasília.
    jest.useFakeTimers({ now: new Date('2026-11-13T01:30:00Z') });
    const { svc, prisma } = build();
    await expect(svc.finishVotacao(9, sindico)).resolves.toEqual({ success: true });
    const { where, data } = prisma.votacoes.update.mock.calls[0][0];
    expect(where).toEqual({ id: 9 });
    expect(data.encerrada_em.toISOString()).toBe('2026-11-13T01:30:00.000Z');
    expect(data.data_termino.toISOString().slice(0, 10)).toBe('2026-11-12');
  });

  it('término já no passado ou hoje: não mexe no término (nada de "ontem")', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-12T15:00:00Z') });
    for (const termino of ['2026-11-12T00:00:00Z', '2026-11-05T00:00:00Z']) {
      const { svc, prisma } = build({ data_termino: new Date(termino) });
      await svc.finishVotacao(9, sindico);
      const { data } = prisma.votacoes.update.mock.calls[0][0];
      expect(data).not.toHaveProperty('data_termino');
      expect(data.encerrada_em).toBeInstanceOf(Date);
    }
  });

  it('encerrar de novo: sucesso, sem regravar', async () => {
    const { svc, prisma } = build({ encerrada_em: new Date('2026-11-10T12:00:00Z') });
    await expect(svc.finishVotacao(9, sindico)).resolves.toEqual({ success: true });
    expect(prisma.votacoes.update).not.toHaveBeenCalled();
  });

  it('calcStatusInt: encerrada_em preenchido → 2, mesmo dentro do período', () => {
    const svc = new AssembleiasService({} as any, {} as any, {} as any);
    const calc = (svc as any).calcStatusInt.bind(svc);
    expect(calc(new Date('2020-01-01T00:00:00Z'), new Date('2099-01-01T00:00:00Z'), new Date())).toBe(2);
    expect(calc(new Date('2020-01-01T00:00:00Z'), new Date('2099-01-01T00:00:00Z'), null)).toBe(1);
    // Linha antiga, encerrada com término = ontem: continua 2.
    const ontem = new Date(Date.now() - 2 * 86_400_000);
    expect(calc(new Date('2020-01-01T00:00:00Z'), ontem, null)).toBe(2);
  });

  it('lista: encerrada hoje aparece encerrada, com o término de hoje', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-13T15:00:00Z') });
    const prisma: any = {
      isConnected: true,
      votacoes: {
        findMany: jest.fn(async () => [{
          id: 9, id_condominio: 1, titulo: 'Academia', descricao: '', created_at: new Date(), id_assembleia: null,
          data_inicio: new Date('2026-11-13T00:00:00Z'), data_termino: new Date('2026-11-13T00:00:00Z'),
          encerrada_em: new Date('2026-11-13T14:00:00Z'), somente_proprietarios: 0, opcoes: [],
        }]),
      },
    };
    const tenant: any = { assertCondominio: jest.fn(async () => undefined) };
    const svc = new AssembleiasService(prisma, {} as any, tenant);
    const [v]: any = await svc.enqueteGetAll(1, sindico);
    expect([v.data_inicio, v.data_termino, v.status]).toEqual(['13/11/2026', '13/11/2026', 2]);
    expect(v.encerrada_em).toBe('2026-11-13T14:00:00.000Z');
  });

  it('payload do app 1.2.48 ({ id: "9" }) chega ao serviço como número', () => {
    const service: any = { finishVotacao: jest.fn(async () => ({ success: true })) };
    new AssembleiasController(service).finishVotacao({ id: '9' }, sindico);
    expect(service.finishVotacao).toHaveBeenCalledWith(9, sindico);
  });
});
