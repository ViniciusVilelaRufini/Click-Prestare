import { NotFoundException } from '@nestjs/common';
import { PrestadoresService } from './prestadores.service';

/**
 * O TenantGuard valida o :idCondominio do path contra o JWT, mas NÃO impede
 * que o :id do prestador seja de outro condomínio. Estes testes garantem que
 * findOne/update/remove negam (404) quando o prestador não é do condomínio
 * informado na URL.
 */
describe('PrestadoresService — autorização de tenant (IDOR)', () => {
  const prestadorCond2 = { id: 700, id_condominio: 2, nome: 'Encanador', apartamento: null };

  function build() {
    const prisma: any = {
      isConnected: true,
      prestadores_servico: {
        findUnique: jest.fn(async ({ where }: any) =>
          where.id === 700 ? { ...prestadorCond2 } : null,
        ),
        update: jest.fn(async () => ({ ...prestadorCond2 })),
        delete: jest.fn(async () => ({})),
      },
    };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    return { svc: new PrestadoresService(prisma, storage), prisma };
  }

  it('findOne nega prestador de outro condomínio (404)', async () => {
    const { svc } = build();
    await expect(svc.findOne(700, 1)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('findOne permite prestador do mesmo condomínio', async () => {
    const { svc } = build();
    await expect(svc.findOne(700, 2)).resolves.toMatchObject({ id: 700 });
  });

  it('update nega cross-tenant e NÃO escreve', async () => {
    const { svc, prisma } = build();
    await expect(svc.update(700, { nome: 'x' }, 1)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.prestadores_servico.update).not.toHaveBeenCalled();
  });

  it('remove nega cross-tenant e NÃO deleta', async () => {
    const { svc, prisma } = build();
    await expect(svc.remove(700, 1)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.prestadores_servico.delete).not.toHaveBeenCalled();
  });

  it('remove permite mesmo condomínio', async () => {
    const { svc, prisma } = build();
    await svc.remove(700, 2);
    expect(prisma.prestadores_servico.delete).toHaveBeenCalled();
  });
});
