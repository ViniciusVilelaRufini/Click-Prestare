import { MobileAuthService } from './mobile-auth.service';

/**
 * `listBeneficiariosVaga()` lista visitantes possíveis pra liberar uma vaga
 * (equivalente mobile de `VagasService.beneficiarios`). Task "Lote C":
 * read-only — leitura migra para `Pessoas`/`Visitas` sob a flag;
 * `liberarVaga` (escrita, mais abaixo no arquivo) não é tocado aqui.
 */
describe('MobileAuthService — listBeneficiariosVaga() (Pessoas/Visitas)', () => {
  const originalFlag = process.env['PESSOAS_MIGRATION_ENABLED'];

  afterEach(() => {
    if (originalFlag === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = originalFlag;
  });

  function build() {
    const prisma: any = {
      isConnected: true,
      moradores: {
        findFirst: jest.fn(async () => ({ id: 1, id_condominio: 1 })),
      },
      apartamentos_Users: {
        findFirst: jest.fn(async () => ({ apartamento: { id: 101, id_condominio: 1, bloco: 'A', apto: '101' } })),
        findMany: jest.fn(async () => []),
      },
      apartamentos: {
        findUnique: jest.fn(async () => ({ id_condominio: 1 })),
      },
      visitantes: {
        findMany: jest.fn(async () => [
          { id: 1, nome: 'Ana', doc_identificacao: '111', foto_pessoa: 'foto.jpg', created_at: new Date() },
        ]),
      },
      visitas: {
        findMany: jest.fn(async () => [
          { pessoa: { id: 50, nome: 'Ana', doc_identificacao: '111', foto_pessoa: 'foto.jpg' } },
        ]),
      },
    };
    const jwt: any = {};
    const mail: any = {};
    const storage: any = {};
    const facial: any = {};
    const tenant: any = { assertEntidade: jest.fn(async () => undefined) };
    const financeiro: any = {};
    const apartamentosSvc: any = {};
    const notifications: any = {};
    const superlogicaWrite: any = {};
    const svc = new MobileAuthService(
      prisma, jwt, mail, storage, facial, tenant, financeiro, apartamentosSvc, notifications, superlogicaWrite,
    );
    return { svc, prisma };
  }

  it('flag OFF: lê Visitantes e nunca toca Visitas', async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';
    const { svc, prisma } = build();
    const r = await svc.listBeneficiariosVaga(9, 1);
    expect(r.visitantes).toEqual([{ id: 1, nome: 'Ana', doc_identificacao: '111', tem_foto: true }]);
    expect(prisma.visitantes.findMany).toHaveBeenCalled();
    expect(prisma.visitas.findMany).not.toHaveBeenCalled();
  });

  it('flag ON: lê Visitas+Pessoa e nunca toca Visitantes', async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const { svc, prisma } = build();
    const r = await svc.listBeneficiariosVaga(9, 1);
    expect(r.visitantes).toEqual([{ id: 50, nome: 'Ana', doc_identificacao: '111', tem_foto: true }]);
    expect(prisma.visitas.findMany).toHaveBeenCalled();
    expect(prisma.visitantes.findMany).not.toHaveBeenCalled();
  });
});
