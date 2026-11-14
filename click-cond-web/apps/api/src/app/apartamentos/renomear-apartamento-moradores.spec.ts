import { BadRequestException } from '@nestjs/common';
import { ApartamentosService } from './apartamentos.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Pendência da revisão da rodada 2: renomear a unidade (bloco/apto) não levava o texto novo ao
 * cadastro dos moradores dela. A unidade de cada linha de Moradores é o bloco/apto gravados nela
 * (lista, edição, encomendas): com o texto antigo, a linha deixava de casar com o vínculo.
 * Revisão da rodada 3: na mesma transação do update, e incluindo as linhas sem conta (id_user nulo)
 * pelo texto antigo exato.
 */
describe('ApartamentosService.update — renomear a unidade atualiza o cadastro dos moradores', () => {
  const sindico: JwtPayload = { sub: 1, nome: 'Síndico', typeAccess: 'Sindico', id_condominio: 1 };

  function build(opts: { updateManyFalha?: boolean } = {}) {
    const tx: any = {
      apartamentos: {
        update: jest.fn(async ({ data }: any) => ({ id: 5, id_condominio: 1, apto: '101', bloco: 'A', ...data })),
      },
      apartamentos_Users: { findMany: jest.fn(async () => [{ id_user: 7 }, { id_user: 8 }, { id_user: 7 }]) },
      moradores: {
        findMany: jest.fn(async () => [
          { id: 70, id_user: 7, bloco: 'Bloco A', apartamento: '101' }, // mesma unidade, outro jeito de escrever o bloco
          { id: 71, id_user: 7, bloco: 'A', apartamento: '102' }, // outra unidade do mesmo morador
          { id: 80, id_user: 8, bloco: 'A', apartamento: ' 101 ' },
          { id: 90, id_user: null, bloco: 'A', apartamento: '101' }, // sem conta, texto exato
          { id: 91, id_user: null, bloco: 'Bloco A', apartamento: '101' }, // sem conta, texto diferente: fica
        ]),
        updateMany: jest.fn(async () => {
          if (opts.updateManyFalha) throw Object.assign(new Error('falhou'), { code: 'P1001' });
          return { count: 3 };
        }),
      },
    };
    const prisma: any = {
      isConnected: true,
      apartamentos: { findUnique: jest.fn(async () => ({ id_condominio: 1, apto: '101', bloco: 'A' })) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const tenant: any = {
      assertEntidade: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async () => undefined),
    };
    const svc = new ApartamentosService(prisma, tenant, { registrar: jest.fn() } as any);
    return { svc, prisma, tx };
  }

  it('leva o bloco/apto novos às linhas da unidade, na mesma transação do update', async () => {
    const { svc, prisma, tx } = build();

    await svc.update(5, { bloco: 'B', apto: '201' }, sindico);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.apartamentos.update).toHaveBeenCalled();
    expect(tx.moradores.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id_condominio: 1,
          OR: [{ id_user: { in: [7, 8] } }, { id_user: null, bloco: 'A', apartamento: '101' }],
        },
      }),
    );
    expect(tx.moradores.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [70, 80, 90] } },
      data: { bloco: 'B', apartamento: '201' },
    });
  });

  it('falha ao atualizar os moradores desfaz a renomeação (erro, não sucesso parcial)', async () => {
    const { svc } = build({ updateManyFalha: true });
    await expect(svc.update(5, { bloco: 'B', apto: '201' }, sindico)).rejects.toThrow(BadRequestException);
  });

  it('editar só a fração ou as vagas não mexe nos moradores', async () => {
    const { svc, tx } = build();

    await svc.update(5, { fracao: '0.02', bloco: 'A', apto: '101' }, sindico);

    expect(tx.moradores.updateMany).not.toHaveBeenCalled();
  });
});
