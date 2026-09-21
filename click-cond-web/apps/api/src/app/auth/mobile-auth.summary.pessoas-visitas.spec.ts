import { MobileAuthService } from './mobile-auth.service';

/**
 * `getSummary()` alimenta o resumo do dashboard do app (funcionário e
 * morador). Task "Lote C": as contagens de visitas migram para `Visitas`
 * sob a flag, sem nunca tocar `Visitantes` nesse caminho (e vice-versa).
 */
describe('MobileAuthService — getSummary() (Pessoas/Visitas)', () => {
  const originalFlag = process.env['PESSOAS_MIGRATION_ENABLED'];

  afterEach(() => {
    if (originalFlag === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = originalFlag;
  });

  function build() {
    const prisma: any = {
      isConnected: true,
      funcionarios: { findFirst: jest.fn(async () => ({ id_condominio: 1 })) },
      users: { findUnique: jest.fn(async () => null) },
      funcionarios_Portaria: { findFirst: jest.fn(async () => null) },
      encomendas: { count: jest.fn(async () => 0) },
      visitantes: { count: jest.fn(async () => 5) },
      visitas: { count: jest.fn(async () => 5) },
      ocorrencias: { count: jest.fn(async () => 0) },
      apartamentos_Users: { findMany: jest.fn(async () => [{ id_apto: 101 }]) },
      moradores: { findMany: jest.fn(async () => []) },
    };
    const jwt: any = {};
    const mail: any = {};
    const storage: any = {};
    const facial: any = {};
    const tenant: any = {};
    const financeiro: any = {};
    const apartamentos: any = {};
    const notifications: any = {};
    const superlogicaWrite: any = {};
    const svc = new MobileAuthService(
      prisma, jwt, mail, storage, facial, tenant, financeiro, apartamentos, notifications, superlogicaWrite,
    );
    return { svc, prisma };
  }

  describe('perfil Funcionário', () => {
    it('flag OFF: conta visits_today/inside_condo contra Visitantes, nunca toca Visitas', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';
      const { svc, prisma } = build();
      const r: any = await svc.getSummary(1, 'Funcionario');
      expect(r.visits_today).toBe(5);
      expect(r.inside_condo).toBe(5);
      expect(prisma.visitantes.count).toHaveBeenCalled();
      expect(prisma.visitas.count).not.toHaveBeenCalled();
    });

    it('flag ON: conta visits_today/inside_condo contra Visitas, nunca toca Visitantes', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
      const { svc, prisma } = build();
      const r: any = await svc.getSummary(1, 'Funcionario');
      expect(r.visits_today).toBe(5);
      expect(r.inside_condo).toBe(5);
      expect(prisma.visitas.count).toHaveBeenCalled();
      expect(prisma.visitantes.count).not.toHaveBeenCalled();
    });
  });

  describe('perfil Morador', () => {
    it('flag OFF: conta visits contra Visitantes, nunca toca Visitas', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';
      const { svc, prisma } = build();
      const r: any = await svc.getSummary(2, 'Morador');
      expect(r.visits).toBe(5);
      expect(prisma.visitantes.count).toHaveBeenCalled();
      expect(prisma.visitas.count).not.toHaveBeenCalled();
    });

    it('flag ON: conta visits contra Visitas, nunca toca Visitantes', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
      const { svc, prisma } = build();
      const r: any = await svc.getSummary(2, 'Morador');
      expect(r.visits).toBe(5);
      expect(prisma.visitas.count).toHaveBeenCalled();
      expect(prisma.visitantes.count).not.toHaveBeenCalled();
    });
  });
});
