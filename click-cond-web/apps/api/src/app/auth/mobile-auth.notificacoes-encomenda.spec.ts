import { MobileAuthService } from './mobile-auth.service';

/**
 * `getNotificacoes()` deriva o feed do estado atual da encomenda. Encomenda
 * `Esperando` (o morador avisou que vai chegar) não pode aparecer como
 * "chegou e está aguardando retirada" — ela ainda não chegou na portaria.
 */
describe('MobileAuthService — getNotificacoes() encomendas por status', () => {
  const created_at = new Date('2026-10-01T10:00:00Z');
  const recebido_em = new Date('2026-10-03T14:00:00Z');
  const retirado_em = new Date('2026-10-04T09:00:00Z');

  function build(status: string, extra: Record<string, any> = {}) {
    const prisma: any = {
      isConnected: true,
      users: {
        findUnique: jest.fn(async () => ({
          notif_encomendas: 1,
          notif_comunicados: 0,
          notif_ocorrencias: 0,
          notif_visitantes: 0,
        })),
      },
      moradores: {
        findMany: jest.fn(async () => [
          { id_condominio: 1, apartamento: '101', bloco: 'A' },
        ]),
      },
      apartamentos_Users: { findMany: jest.fn(async () => []) },
      encomendas: {
        findMany: jest.fn(async () => [
          { id: 5, descricao: 'Caixa dos Correios', status, created_at, ...extra },
        ]),
      },
      visitantes: { findMany: jest.fn(async () => []) },
      visitas: { findMany: jest.fn(async () => []) },
      financeiro: { findMany: jest.fn(async () => []) },
      areas_Sociais_Agendamentos: { findMany: jest.fn(async () => []) },
    };
    const svc = new MobileAuthService(
      prisma, {} as any, {} as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    return { svc };
  }

  async function itemEncomenda(status: string, extra: Record<string, any> = {}) {
    const { svc } = build(status, extra);
    const itens: any[] = await svc.getNotificacoes(9);
    const item = itens.find((i) => i.tipo === 'encomenda');
    expect(item).toBeDefined();
    expect(item.id).toBe('encomenda-5');
    return item;
  }

  it('Esperando: "a caminho", sem afirmar que chegou', async () => {
    const item = await itemEncomenda('Esperando');
    expect(item.titulo).toBe('Encomenda a caminho');
    expect(item.descricao).toBe('Caixa dos Correios foi avisada e ainda não chegou na portaria.');
  });

  it('esperando em minúsculas (comparação case-insensitive)', async () => {
    const item = await itemEncomenda('esperando');
    expect(item.titulo).toBe('Encomenda a caminho');
  });

  it('Aguardando: mantém o texto de encomenda recebida', async () => {
    const item = await itemEncomenda('Aguardando');
    expect(item.titulo).toBe('Encomenda recebida');
    expect(item.descricao).toBe('Caixa dos Correios chegou e está aguardando retirada.');
  });

  it('Retirada: mantém o texto de encomenda retirada', async () => {
    const item = await itemEncomenda('Retirada');
    expect(item.titulo).toBe('Encomenda retirada');
    expect(item.descricao).toBe('Caixa dos Correios foi retirada.');
  });

  // O app compara `timestamp` com a última visita ao feed: o feed precisa
  // refletir o evento mais recente (chegada/retirada), não o aviso inicial.
  describe('timestamp = momento do evento mais recente', () => {
    it('Esperando: usa created_at (o aviso), ignora recebido_em', async () => {
      const item = await itemEncomenda('Esperando', { recebido_em, retirado_em: null });
      expect(item.timestamp).toBe(created_at);
    });

    it('Aguardando: usa recebido_em (chegada na portaria), não o aviso', async () => {
      const item = await itemEncomenda('Aguardando', { recebido_em, retirado_em: null });
      expect(item.timestamp).toBe(recebido_em);
    });

    it('Aguardando sem recebido_em: cai para created_at', async () => {
      const item = await itemEncomenda('Aguardando', { recebido_em: null });
      expect(item.timestamp).toBe(created_at);
    });

    it('Retirada: usa retirado_em', async () => {
      const item = await itemEncomenda('Retirada', { recebido_em, retirado_em });
      expect(item.timestamp).toBe(retirado_em);
    });

    it('Retirada sem retirado_em: cai para recebido_em e depois created_at', async () => {
      expect((await itemEncomenda('Retirada', { recebido_em, retirado_em: null })).timestamp).toBe(recebido_em);
      expect((await itemEncomenda('Retirada', { recebido_em: null, retirado_em: null })).timestamp).toBe(created_at);
    });
  });
});
