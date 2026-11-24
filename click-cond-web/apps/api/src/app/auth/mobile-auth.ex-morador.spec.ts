import { MobileAuthService } from './mobile-auth.service';

/**
 * V2 — ex-morador de unidade excluída. `apartamentos.remove` apaga o vínculo
 * (Apartamentos_Users, em cascata) mas deixa a linha em Moradores, só sem
 * bloco/apto. O feed (comunicados dos últimos 30 dias) e a lista de
 * ocorrências públicas liam o condomínio por Moradores, e o ex-morador seguia
 * lendo tudo. Morador atual = vínculo em Apartamentos_Users numa unidade do
 * condomínio (o critério do assertCondominio).
 */
describe('MobileAuthService — ex-morador não lê comunicados nem ocorrências públicas', () => {
  const ID_USER = 9;
  const comunicado = { id: 3, titulo: 'Troca do portão', descricao: '<p>Amanhã</p>', created_at: new Date() };

  function build(opts: { vinculado: boolean }) {
    const prisma: any = {
      isConnected: true,
      users: {
        findUnique: jest.fn(async () => ({
          notif_encomendas: 0,
          notif_comunicados: 1,
          notif_ocorrencias: 0,
          notif_visitantes: 0,
        })),
      },
      // A linha de Moradores continua lá nos dois casos (sem bloco/apto no ex-morador).
      moradores: {
        findMany: jest.fn(async () => [{ id_condominio: 1, apartamento: null, bloco: null }]),
        findFirst: jest.fn(async () => ({ id_condominio: 1 })),
      },
      apartamentos_Users: {
        findMany: jest.fn(async () => (opts.vinculado ? [{ id_apto: 5, apartamento: { id_condominio: 1 } }] : [])),
        findFirst: jest.fn(async () => (opts.vinculado ? { apartamento: { id_condominio: 1 } } : null)),
      },
      comunicados: {
        findMany: jest.fn(async ({ where }: any) => (where.id_condominio.in.includes(1) ? [comunicado] : [])),
      },
      ocorrencias: { findMany: jest.fn(async () => []) },
      encomendas: { findMany: jest.fn(async () => []) },
      visitantes: { findMany: jest.fn(async () => []) },
      visitas: { findMany: jest.fn(async () => []) },
      financeiro: { findMany: jest.fn(async () => []) },
      areas_Sociais_Agendamentos: { findMany: jest.fn(async () => []) },
    };
    const svc = new MobileAuthService(
      prisma, {} as any, {} as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    return { svc, prisma };
  }

  describe('feed de notificações', () => {
    it('ex-morador (sem vínculo com unidade) não recebe os comunicados', async () => {
      const { svc, prisma } = build({ vinculado: false });
      const itens: any[] = await svc.getNotificacoes(ID_USER);
      expect(itens.filter((i) => i.tipo === 'comunicado')).toEqual([]);
      expect(prisma.comunicados.findMany).not.toHaveBeenCalled();
    });

    it('morador atual recebe os comunicados do condomínio da unidade', async () => {
      const { svc, prisma } = build({ vinculado: true });
      const itens: any[] = await svc.getNotificacoes(ID_USER);
      expect(itens.find((i) => i.tipo === 'comunicado')).toMatchObject({ id: 'comunicado-3', descricao: 'Amanhã' });
      expect(prisma.comunicados.findMany.mock.calls[0][0].where.id_condominio).toEqual({ in: [1] });
    });
  });

  describe('listOcorrencias', () => {
    const publicas = (where: any) => (where.OR as any[]).filter((c) => c.publica === true);

    it('ex-morador vê só as próprias, não as públicas do condomínio', async () => {
      const { svc, prisma } = build({ vinculado: false });
      await svc.listOcorrencias(ID_USER);
      const where = prisma.ocorrencias.findMany.mock.calls[0][0].where;
      expect(publicas(where)).toEqual([]);
      expect(where.OR).toContainEqual({ user: ID_USER, condominio: { ativo: 1 } });
    });

    it('morador atual vê as públicas do condomínio da unidade (só de condomínio ativo)', async () => {
      const { svc, prisma } = build({ vinculado: true });
      await svc.listOcorrencias(ID_USER);
      const where = prisma.ocorrencias.findMany.mock.calls[0][0].where;
      expect(publicas(where)).toEqual([{ id_condominio: 1, publica: true }]);
      expect(prisma.apartamentos_Users.findFirst.mock.calls[0][0].where).toEqual({
        id_user: ID_USER,
        apartamento: { condominio: { ativo: 1 } },
      });
    });
  });
});
