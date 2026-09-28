import { ApartamentosService } from './apartamentos.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Excluir o apartamento levava os vínculos em cascata, mas o cadastro do
 * morador continuava com o bloco/apto antigos. Encomenda (push e contador do
 * app) casa morador por esse texto: recriado o "101", o ex-morador passava a
 * receber as encomendas dos novos moradores.
 */
describe('ApartamentosService.remove — cadastro dos moradores da unidade', () => {
  const sindico: JwtPayload = { sub: 1, nome: 'Síndico', typeAccess: 'Sindico', id_condominio: 1 };

  it('limpa bloco/apto dos moradores que estavam vinculados', async () => {
    const prisma: any = {
      isConnected: true,
      apartamentos: {
        findUnique: jest.fn(async () => ({ id_condominio: 1, apto: '101', bloco: 'Bloco A' })),
        delete: jest.fn(async () => ({ id: 5 })),
      },
      apartamentos_Users: {
        count: jest.fn(async () => 2),
        findMany: jest.fn(async () => [{ id_user: 7 }, { id_user: 8 }]),
      },
      visitantes: { count: jest.fn(async () => 0) },
      vagas: { count: jest.fn(async () => 0) },
      areas_Sociais_Agendamentos: { count: jest.fn(async () => 0) },
      mudancas: { count: jest.fn(async () => 0) },
      moradores: { updateMany: jest.fn(async () => ({ count: 2 })) },
    };
    const tenant: any = {
      assertEntidade: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async () => undefined),
    };
    const svc = new ApartamentosService(prisma, tenant, { registrar: jest.fn() } as any);

    await svc.remove(5, sindico);

    expect(prisma.moradores.updateMany).toHaveBeenCalledWith({
      where: { id_condominio: 1, id_user: { in: [7, 8] }, apartamento: '101', bloco: 'Bloco A' },
      data: { bloco: null, apartamento: null },
    });
  });
});
