import { FacialService } from './facial.service';

describe('FacialService.listSyncPessoas', () => {
  it('expõe o erro real persistido para a pessoa com falha de sincronização', async () => {
    const service = Object.create(FacialService.prototype) as FacialService;
    (service as any).prisma = {
      isConnected: true,
      moradores: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 10,
            nome: 'Fornecedor com erro',
            tipo: 'MORADOR',
            foto_pessoa: 'foto.jpg',
            face_sync_status: 'error',
            face_sync_error: 'Foto recusada pelo terminal: rosto não detectado.',
          },
        ]),
      },
      visitantes: { findMany: jest.fn().mockResolvedValue([]) },
    };

    await expect(service.listSyncPessoas(7)).resolves.toEqual([
      expect.objectContaining({
        id: 10,
        status: 'error',
        motivo_detalhado: 'Foto recusada pelo terminal: rosto não detectado.',
      }),
    ]);
  });
});

describe('FacialService aguardando aceite da biometria', () => {
  function build(moradores: any[], consent: Record<number, boolean>, counts?: any) {
    const service = Object.create(FacialService.prototype) as FacialService;
    const c = counts ?? {};
    (service as any).logger = { warn: jest.fn(), log: jest.fn() };
    (service as any)._estado = { obter: jest.fn().mockResolvedValue(null) };
    (service as any).consentimentos = {
      biometriaAutorizadaPorUsuario: jest.fn(async (ids: number[]) => {
        const m = new Map<number, boolean>();
        for (const id of ids) if (id in consent) m.set(id, consent[id]);
        return m;
      }),
    };
    (service as any).prisma = {
      isConnected: true,
      moradores: {
        // Honra a semântica do SQL: `NOT (status = 'synced')` descarta linha com status NULL.
        findMany: jest.fn(async ({ where }: any = {}) => {
          const cond = (r: any, c: any): boolean =>
            c.NOT ? r.face_sync_status !== null && r.face_sync_status !== c.NOT.face_sync_status : true;
          return moradores.filter((r) => {
            if (where?.NOT && !cond(r, where)) return false;
            if (where?.OR && where.OR.some((o: any) => "face_sync_status" in o)) {
              const ok = where.OR.some((o: any) =>
                o.face_sync_status === null
                  ? r.face_sync_status === null
                  : r.face_sync_status !== null && r.face_sync_status !== o.face_sync_status.not,
              );
              if (!ok) return false;
            }
            return true;
          });
        }),
        count: jest.fn(async ({ where }: any) => {
          if (where.face_sync_status === 'synced') return c.synced ?? 0;
          if (where.face_sync_status === 'error') return c.error ?? 0;
          if (where.foto_pessoa) return c.comFoto ?? moradores.length;
          return c.total ?? moradores.length;
        }),
      },
      visitantes: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    return service;
  }
  const m = (id: number, id_user: number | null, status: string | null, extra: any = {}) => ({
    id, id_user, nome: `M${id}`, tipo: 'MORADOR', foto_pessoa: 'f.jpg',
    face_sync_status: status, face_sync_error: null, ...extra,
  });

  it('nao respondeu e recusou aparecem igual, como aguardando_aceite, com o motivo exato', async () => {
    const service = build([m(1, 11, 'pending'), m(2, 12, 'pending'), m(3, 13, 'pending')], { 12: false, 13: true });
    const lista: any[] = await service.listSyncPessoas(7);
    const por = (id: number) => lista.find((x) => x.id === id);
    expect(por(1).status).toBe('aguardando_aceite');
    expect(por(2).status).toBe('aguardando_aceite');
    expect(por(1).motivo).toBe('Aguardando o morador autorizar a biometria no app.');
    expect(por(1).motivo).toBe(por(2).motivo);
    expect(por(1).motivo_detalhado).toBe(por(2).motivo_detalhado);
    expect(por(3).status).toBe('pending');
  });

  it('o aceite pendente vale mais que um erro antigo; synced continua synced', async () => {
    const service = build([m(1, 11, 'error', { face_sync_error: 'x' }), m(2, 12, 'synced')], {});
    const lista: any[] = await service.listSyncPessoas(7);
    expect(lista.find((x) => x.id === 1).status).toBe('aguardando_aceite');
    expect(lista.find((x) => x.id === 2).status).toBe('synced');
  });

  it('getSyncStatus tira quem espera aceite de pending e de error e conta a parte', async () => {
    const rows = [m(1, 11, 'pending'), m(2, 12, 'error'), m(3, 13, null)];
    const service = build(rows, { 13: true }, { synced: 0, error: 1, comFoto: 3, total: 3 });
    const r: any = await service.getSyncStatus(7);
    expect(r.aguardando_aceite).toBe(2);
    expect(r.error).toBe(0);
    expect(r.pending).toBe(1);
  });

  it('getSyncStatus: foto nova (status NULL) sem aceite conta em aguardando_aceite e nao em pending', async () => {
    const service = build([m(1, 11, null)], {}, { synced: 0, error: 0, comFoto: 1, total: 1 });
    const r: any = await service.getSyncStatus(7);
    expect(r.aguardando_aceite).toBe(1);
    expect(r.pending).toBe(0);
    expect(r.error).toBe(0);
  });
});
