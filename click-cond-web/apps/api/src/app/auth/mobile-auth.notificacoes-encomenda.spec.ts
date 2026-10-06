import { MobileAuthService } from './mobile-auth.service';

/**
 * `getNotificacoes()` deriva o feed do estado atual da encomenda. Encomenda
 * `Esperando` (o morador avisou que vai chegar) não pode aparecer como
 * "chegou e está aguardando retirada" — ela ainda não chegou na portaria.
 */
describe('MobileAuthService — getNotificacoes() encomendas por status', () => {
  function build(status: string) {
    const created_at = new Date();
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
          { id: 5, descricao: 'Caixa dos Correios', status, created_at },
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
    return { svc, created_at };
  }

  async function itemEncomenda(status: string) {
    const { svc, created_at } = build(status);
    const itens: any[] = await svc.getNotificacoes(9);
    const item = itens.find((i) => i.tipo === 'encomenda');
    expect(item).toBeDefined();
    expect(item.id).toBe('encomenda-5');
    expect(item.timestamp).toBe(created_at);
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
});
