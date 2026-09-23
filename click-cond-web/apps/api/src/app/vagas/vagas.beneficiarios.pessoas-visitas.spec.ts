import { VagasService } from './vagas.service';

/**
 * `beneficiarios()` lista visitantes possíveis para liberar uma vaga.
 * Task "Lote C": leitura migra para `Pessoas`/`Visitas` sob a flag — só a
 * leitura; `liberar()` (escrita) fica para outra rodada e não é tocado aqui.
 */
describe('VagasService — beneficiarios() (Pessoas/Visitas)', () => {
  const originalFlag = process.env['PESSOAS_MIGRATION_ENABLED'];

  afterEach(() => {
    if (originalFlag === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = originalFlag;
  });

  function build() {
    const prisma: any = {
      isConnected: true,
      apartamentos: {
        findFirst: jest.fn(async () => ({ id: 101, id_condominio: 1, bloco: 'A', apto: '101', qtd_vagas: 2 })),
      },
      moradores: {
        findMany: jest.fn(async () => [{ id: 9, nome: 'Inquilino Teste', tipo: 'Inquilino' }]),
      },
      visitantes: {
        findMany: jest.fn(async () => [
          { id: 1, nome: 'Ana', doc_identificacao: '111', foto_pessoa: 'foto.jpg', created_at: new Date() },
        ]),
      },
      visitas: {
        findMany: jest.fn(async () => [
          {
            pessoa: { id: 50, nome: 'Ana', doc_identificacao: '111', foto_pessoa: 'foto.jpg' },
          },
          {
            // mesma pessoa em duas visitas — precisa deduplicar por pessoa.id
            pessoa: { id: 50, nome: 'Ana', doc_identificacao: '111', foto_pessoa: 'foto.jpg' },
          },
        ]),
      },
    };
    const facial: any = {};
    const svc = new VagasService(prisma, facial);
    return { svc, prisma };
  }

  it('flag OFF: lê Visitantes e nunca toca Visitas', async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';
    const { svc, prisma } = build();
    const r = await svc.beneficiarios(1, 101);
    expect(r.visitantes).toEqual([{ id: 1, nome: 'Ana', doc_identificacao: '111', tem_foto: true }]);
    expect(prisma.visitantes.findMany).toHaveBeenCalled();
    expect(prisma.visitas.findMany).not.toHaveBeenCalled();
  });

  it('flag ON: lê Visitas+Pessoa, deduplica por pessoa.id e nunca toca Visitantes', async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const { svc, prisma } = build();
    const r = await svc.beneficiarios(1, 101);
    expect(r.visitantes).toEqual([{ id: 50, nome: 'Ana', doc_identificacao: '111', tem_foto: true }]);
    expect(prisma.visitas.findMany).toHaveBeenCalled();
    expect(prisma.visitantes.findMany).not.toHaveBeenCalled();
  });

  it('flag ON: inquilinos continuam vindo de Moradores normalmente', async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const { svc } = build();
    const r = await svc.beneficiarios(1, 101);
    expect(r.inquilinos).toEqual([{ id: 9, nome: 'Inquilino Teste' }]);
  });
});
