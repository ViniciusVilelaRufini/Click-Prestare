import { MobileAuthService } from './mobile-auth.service';

/**
 * `getNotificacoes()` inclui as solicitações de autorização pendentes
 * (Portaria Remota) no feed do morador. Task "Lote C": essa leitura migra
 * para `Visitas`+`Pessoa` sob a flag.
 *
 * Investigação do contrato do id `solicitacao-${id}`: o app
 * (notificacoes_page.dart, `_abrir()`) extrai o número mas, para os tipos
 * 'solicitacao'/'autorizacao_visitante', abre `PendentesVisitantePage()`
 * SEM repassar o id — essa tela busca sua própria lista via
 * GET /visitantes/pendentes (`VisitantesService.listarPendentes`, já
 * migrado), que devolve id de Visita. Não há contrato quebrado: o id aqui é
 * decorativo. Mesmo assim, o código passou a emitir id de Visita no
 * caminho migrado, para não divergir do que `autorizar`/`negar` esperam
 * caso um consumidor futuro passe a usar esse id.
 */
describe('MobileAuthService — getNotificacoes() solicitações pendentes (Pessoas/Visitas)', () => {
  const originalFlag = process.env['PESSOAS_MIGRATION_ENABLED'];

  afterEach(() => {
    if (originalFlag === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = originalFlag;
  });

  function build() {
    const prisma: any = {
      isConnected: true,
      users: {
        findUnique: jest.fn(async () => ({
          notif_encomendas: 0,
          notif_comunicados: 0,
          notif_ocorrencias: 0,
          notif_visitantes: 0,
        })),
      },
      moradores: { findMany: jest.fn(async () => []) },
      apartamentos_Users: { findMany: jest.fn(async () => [{ id_apto: 101 }]) },
      visitantes: {
        findMany: jest.fn(async () => [
          { id: 7, nome: 'Pedro Legado', auth_solicitado_em: new Date(), data_hora_inicio: new Date() },
        ]),
      },
      visitas: {
        findMany: jest.fn(async () => [
          {
            id: 777,
            auth_solicitado_em: new Date(),
            data_hora_inicio: new Date(),
            pessoa: { nome: 'Pedro Migrado' },
          },
        ]),
      },
      financeiro: { findMany: jest.fn(async () => []) },
      areas_Sociais_Agendamentos: { findMany: jest.fn(async () => []) },
    };
    const jwt: any = {};
    const mail: any = {};
    const storage: any = {};
    const facial: any = {};
    const tenant: any = {};
    const financeiroSvc: any = {};
    const apartamentosSvc: any = {};
    const notifications: any = {};
    const superlogicaWrite: any = {};
    const svc = new MobileAuthService(
      prisma, jwt, mail, storage, facial, tenant, financeiroSvc, apartamentosSvc, notifications, superlogicaWrite,
    );
    return { svc, prisma };
  }

  it('flag OFF: lê Visitantes e nunca toca Visitas; id = Visitantes.id', async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';
    const { svc, prisma } = build();
    const itens: any[] = await svc.getNotificacoes(9);
    const item = itens.find((i) => i.tipo === 'solicitacao');
    expect(item).toBeDefined();
    expect(item.id).toBe('solicitacao-7');
    expect(item.descricao).toContain('Pedro Legado');
    expect(prisma.visitantes.findMany).toHaveBeenCalled();
    expect(prisma.visitas.findMany).not.toHaveBeenCalled();
  });

  it('flag ON: lê Visitas+Pessoa e nunca toca Visitantes; id = Visitas.id (mesmo espaço de autorizar/negar)', async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const { svc, prisma } = build();
    const itens: any[] = await svc.getNotificacoes(9);
    const item = itens.find((i) => i.tipo === 'solicitacao');
    expect(item).toBeDefined();
    expect(item.id).toBe('solicitacao-777');
    expect(item.descricao).toContain('Pedro Migrado');
    expect(prisma.visitas.findMany).toHaveBeenCalled();
    expect(prisma.visitantes.findMany).not.toHaveBeenCalled();
  });
});
