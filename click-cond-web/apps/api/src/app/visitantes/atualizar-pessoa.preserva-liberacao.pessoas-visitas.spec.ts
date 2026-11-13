import { VisitantesService } from './visitantes.service';

/**
 * A tela de edição reenvia `bloqueado` (0) mesmo quando o operador só trocou o
 * nome. A API tratava qualquer `bloqueado: 0` como DESBLOQUEIO e reescrevia
 * `liberado` em todas as visitas da pessoa (visitante → 0, prestador → 1):
 * editar o nome de um visitante liberado revogava a liberação dele.
 */
describe('atualizarPessoa (Pessoas/Visitas) — editar não revoga liberação', () => {
  const original = process.env['PESSOAS_MIGRATION_ENABLED'];
  beforeEach(() => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
  });
  afterEach(() => {
    if (original === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = original;
  });

  function montar(pessoaBloqueada: 0 | 1) {
    const prisma: any = {
      isConnected: true,
      pessoas: {
        findUnique: jest.fn(async () => ({ id: 20, id_condominio: 1, nome: 'Antigo', bloqueado: pessoaBloqueada })),
        update: jest.fn(async () => ({})),
      },
      visitas: { updateMany: jest.fn(async () => ({ count: 1 })) },
    };
    const svc = new VisitantesService(
      prisma, {} as any, { isDataUrl: () => false } as any, {} as any, { registrar: jest.fn() } as any, {} as any,
      { emitToCondominio: jest.fn() } as any,
    );
    jest.spyOn(svc as any, 'fireFacialSyncPessoa').mockImplementation(() => undefined);
    return { svc, prisma };
  }

  it('bloqueado igual ao atual (0 → 0): não mexe em liberado', async () => {
    const { svc, prisma } = montar(0);
    await svc.atualizarPessoa(1, 20, { nome: 'Novo', bloqueado: 0 } as any);
    for (const [arg] of prisma.visitas.updateMany.mock.calls) {
      expect(arg.data).not.toHaveProperty('liberado');
    }
  });

  it('desbloqueio de verdade (1 → 0) continua repondo liberado por tipo', async () => {
    const { svc, prisma } = montar(1);
    await svc.atualizarPessoa(1, 20, { bloqueado: 0 } as any);
    const datas = prisma.visitas.updateMany.mock.calls.map(([arg]: any) => arg.data.liberado);
    expect(datas.sort()).toEqual([0, 1]);
  });

  it('bloquear continua revogando liberado e PIN', async () => {
    const { svc, prisma } = montar(0);
    await svc.atualizarPessoa(1, 20, { bloqueado: 1 } as any);
    const data = prisma.visitas.updateMany.mock.calls[0][0].data;
    expect(data.liberado).toBe(0);
    expect(data.codigo_acesso).toBeNull();
  });
});
