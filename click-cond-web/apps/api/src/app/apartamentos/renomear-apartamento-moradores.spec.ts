import { ApartamentosService } from './apartamentos.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Pendência da revisão da rodada 2: renomear a unidade (bloco/apto) não levava o texto novo ao
 * cadastro dos moradores dela. A unidade de cada linha de Moradores é o bloco/apto gravados nela
 * (lista, edição, encomendas): com o texto antigo, a linha deixava de casar com o vínculo.
 */
describe('ApartamentosService.update — renomear a unidade atualiza o cadastro dos moradores', () => {
  const sindico: JwtPayload = { sub: 1, nome: 'Síndico', typeAccess: 'Sindico', id_condominio: 1 };

  function build() {
    const prisma: any = {
      isConnected: true,
      apartamentos: {
        findUnique: jest.fn(async () => ({ id_condominio: 1, apto: '101', bloco: 'A' })),
        update: jest.fn(async ({ data }: any) => ({ id: 5, id_condominio: 1, apto: '101', bloco: 'A', ...data })),
      },
      apartamentos_Users: { findMany: jest.fn(async () => [{ id_user: 7 }, { id_user: 8 }, { id_user: 7 }]) },
      moradores: {
        findMany: jest.fn(async () => [
          { id: 70, bloco: 'Bloco A', apartamento: '101' }, // mesma unidade, outro jeito de escrever o bloco
          { id: 71, bloco: 'A', apartamento: '102' }, // outra unidade do mesmo morador
          { id: 80, bloco: 'A', apartamento: ' 101 ' },
        ]),
        updateMany: jest.fn(async () => ({ count: 2 })),
      },
    };
    const tenant: any = {
      assertEntidade: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async () => undefined),
    };
    const svc = new ApartamentosService(prisma, tenant, { registrar: jest.fn() } as any);
    return { svc, prisma };
  }

  it('leva o bloco/apto novos às linhas dos moradores vinculados que estavam nessa unidade', async () => {
    const { svc, prisma } = build();

    await svc.update(5, { bloco: 'B', apto: '201' }, sindico);

    expect(prisma.moradores.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id_condominio: 1, id_user: { in: [7, 8] } } }),
    );
    expect(prisma.moradores.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [70, 80] } },
      data: { bloco: 'B', apartamento: '201' },
    });
  });

  it('editar só a fração ou as vagas não mexe nos moradores', async () => {
    const { svc, prisma } = build();

    await svc.update(5, { fracao: '0.02', bloco: 'A', apto: '101' }, sindico);

    expect(prisma.moradores.updateMany).not.toHaveBeenCalled();
  });
});
