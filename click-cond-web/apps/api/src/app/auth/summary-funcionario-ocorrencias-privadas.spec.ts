import { MobileAuthService } from './mobile-auth.service';
import { DashboardMobileController } from './mobile-auth.controller';
import { TenantAccessService } from './tenant-access.service';
import type { JwtPayload } from './jwt-payload.interface';

/**
 * O painel do app (GET /dashboard/summary) contava TODAS as ocorrências abertas do condomínio para o
 * funcionário. Sem a flag `ocorrencias`, ele só lê as públicas e as que ele abriu (findAll,
 * relatórios, painel da portaria): a contagem usa o mesmo recorte (recorteOcorrenciasPrivadas).
 */
describe('getSummary — ocorrências privadas no resumo do funcionário', () => {
  const FUNCIONARIO: JwtPayload = { sub: 5, nome: 'Func', typeAccess: 'Funcionario', user: { id: 5 } as any };
  const SINDICO: JwtPayload = { sub: 9, nome: 'Síndico', typeAccess: 'Sindico', user: { id: 9 } as any };
  const ABERTAS = { notIn: ['Solucionado', 'solucionado', 'Resolvida', 'resolvida'] };

  function build(flagOcorrencias: number) {
    const prisma: any = {
      isConnected: true,
      funcionarios: {
        findFirst: jest.fn(async ({ where, select }: any) => {
          if (where.id_user !== 5) return null;
          // assertPermissaoFuncionario pede só a flag; o resumo pede o condomínio.
          if (select?.ocorrencias) return where.id_condominio === 1 ? { ocorrencias: flagOcorrencias } : null;
          return { id_condominio: 1 };
        }),
      },
      sindicos_Condominios: { findMany: jest.fn(async () => [{ id_condominio: 1 }]) },
      financeiro: { findMany: jest.fn(async () => []) },
      users: { findUnique: jest.fn(async () => null) },
      funcionarios_Portaria: { findFirst: jest.fn(async () => null) },
      encomendas: { count: jest.fn(async () => 0) },
      visitantes: { count: jest.fn(async () => 0) },
      visitas: { count: jest.fn(async () => 0) },
      ocorrencias: { count: jest.fn(async () => 3) },
    };
    const tenant = new TenantAccessService(prisma);
    const svc = new MobileAuthService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      tenant,
      undefined as any,
      undefined as any,
      undefined as any,
      undefined as any,
    );
    return { svc, prisma };
  }

  it('funcionário SEM a flag: conta só as públicas e as que ele abriu', async () => {
    const { svc, prisma } = build(0);

    await svc.getSummary(5, 'Funcionario', FUNCIONARIO);

    expect(prisma.ocorrencias.count).toHaveBeenCalledWith({
      where: { id_condominio: 1, status: ABERTAS, OR: [{ publica: true }, { user: 5 }] },
    });
  });

  it('funcionário COM a flag: conta todas, como hoje', async () => {
    const { svc, prisma } = build(1);

    await svc.getSummary(5, 'Funcionario', FUNCIONARIO);

    expect(prisma.ocorrencias.count).toHaveBeenCalledWith({ where: { id_condominio: 1, status: ABERTAS } });
  });

  it('sem o payload, o funcionário cai no recorte (não conta as privadas de terceiros)', async () => {
    const { svc, prisma } = build(0);

    await svc.getSummary(5, 'Funcionario');

    expect(prisma.ocorrencias.count.mock.calls[0][0].where.OR).toEqual([{ publica: true }, { user: 5 }]);
  });

  it('síndico: contagem sem recorte, como hoje', async () => {
    const { svc, prisma } = build(0);

    await svc.getSummary(9, 'Sindico', SINDICO);

    expect(prisma.ocorrencias.count).toHaveBeenCalledWith({
      where: { id_condominio: { in: [1] }, status: ABERTAS },
    });
  });

  it('a rota /dashboard/summary repassa o token ao resumo', () => {
    const service: any = { getSummary: jest.fn(async () => ({})) };
    new DashboardMobileController(service).summary(FUNCIONARIO);
    expect(service.getSummary).toHaveBeenCalledWith(5, 'Funcionario', FUNCIONARIO);
  });
});
