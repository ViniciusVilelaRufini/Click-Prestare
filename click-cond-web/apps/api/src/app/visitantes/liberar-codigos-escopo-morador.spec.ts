import { VisitantesService } from './visitantes.service';

/**
 * Pessoa/visitante compartilhado entre unidades: o morador do apto 10 que libera a PRÓPRIA visita
 * derrubava o PIN da visita aberta da mesma pessoa no apto 20. Operador continua revogando no
 * condomínio inteiro.
 */
describe('Liberar visita — revogação de outros PINs só nas unidades do morador', () => {
  const ENV = process.env['PESSOAS_MIGRATION_ENABLED'];
  afterEach(() => {
    if (ENV === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = ENV;
  });

  const moradorA = { sub: 20, nome: 'Morador A', typeAccess: 'Morador', user: { id: 20 } } as any;
  const porteiro = { sub: 3, nome: 'Portaria', id_condominio: 1, turno: 'Manha' } as any;

  function servico(prisma: any) {
    return new VisitantesService(
      prisma,
      { sendPushNotification: jest.fn(), sendWhatsApp: jest.fn() } as any,
      {} as any,
      { syncVisitante: jest.fn(async () => ({})), syncPessoa: jest.fn(async () => ({})) } as any,
      { registrar: jest.fn(async () => ({})) } as any,
      { assertCondominio: jest.fn(async () => undefined) } as any,
      { emitToCondominio: jest.fn() } as any,
    );
  }
  const vinculosDoMoradorA = {
    findFirst: jest.fn(async ({ where }: any) => (where.id_user === 20 && where.id_apto === 10 ? { id_apto: 10 } : null)),
    findMany: jest.fn(async ({ where }: any) => (where.id_user === 20 ? [{ id_apto: 10 }] : [])),
  };

  describe('legado (Visitantes)', () => {
    beforeEach(() => { delete process.env['PESSOAS_MIGRATION_ENABLED']; });

    function build() {
      const visitor = {
        id: 5, nome: 'Teste', doc_identificacao: null, id_apartamento: 10, id_condominio: 1, bloqueado: 0,
        is_prestador: 0, liberado: 0, auth_status: null, foto_pessoa: null, user: null,
        apartamento: { bloco: 'A', apto: '10' },
      };
      const prisma: any = {
        isConnected: true,
        visitantes: {
          findUnique: jest.fn(async () => ({ ...visitor })),
          update: jest.fn(async ({ data }: any) => ({ ...visitor, ...data })),
          updateMany: jest.fn(async () => ({ count: 0 })),
        },
        apartamentos_Users: vinculosDoMoradorA,
      };
      return { svc: servico(prisma), prisma };
    }

    it('morador: a revogação fica restrita aos apartamentos dele', async () => {
      const { svc, prisma } = build();
      await svc.liberarAcesso(5, moradorA);
      expect(prisma.visitantes.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ nome: 'Teste', id_apartamento: { in: [10] } }) }),
      );
    });

    it('operador: revoga no condomínio inteiro, como antes', async () => {
      const { svc, prisma } = build();
      await svc.liberarAcesso(5, porteiro);
      expect(prisma.visitantes.updateMany.mock.calls[0][0].where).not.toHaveProperty('id_apartamento');
    });
  });

  describe('Pessoas/Visitas', () => {
    beforeEach(() => { process.env['PESSOAS_MIGRATION_ENABLED'] = 'true'; });

    function build() {
      const ref = {
        id: 50, id_pessoa: 7, id_condominio: 1, id_apartamento: 10, liberado: 0, codigo_acesso: '111111',
        data_entrada: null, data_saida: null, bloqueado: 0, is_prestador: 0, auth_status: null,
        pessoa: { id: 7, nome: 'Teste', doc_identificacao: '52998224725', face_id: null },
      };
      const prisma: any = {
        isConnected: true,
        visitas: {
          findUnique: jest.fn(async () => ({ ...ref })),
          update: jest.fn(async ({ data }: any) => ({ ...ref, ...data, apartamento: { bloco: 'A', apto: '10' } })),
          updateMany: jest.fn(async () => ({ count: 0 })),
        },
        pessoas: {},
        apartamentos_Users: vinculosDoMoradorA,
      };
      return { svc: servico(prisma), prisma };
    }

    it('morador: desativarOutrosCodigosVisita recebe os apartamentos dele', async () => {
      const { svc, prisma } = build();
      await svc.liberarAcesso(50, moradorA);
      expect(prisma.visitas.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id_pessoa: 7, id_apartamento: { in: [10] } }) }),
      );
    });

    it('operador: sem recorte por apartamento', async () => {
      const { svc, prisma } = build();
      await svc.liberarAcesso(50, porteiro);
      expect(prisma.visitas.updateMany.mock.calls[0][0].where).not.toHaveProperty('id_apartamento');
    });
  });
});
