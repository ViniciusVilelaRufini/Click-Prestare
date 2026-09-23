import { ForbiddenException } from '@nestjs/common';
import { EncomendasService } from './encomendas.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

describe('EncomendasService — isolamento de condomínio na listagem', () => {
  const operadorCond1: JwtPayload = {
    sub: 10,
    nome: 'Porteiro do condomínio 1',
    id_condominio: 1,
    typeAccess: 'Funcionario',
  };

  function build() {
    const prisma: any = {
      isConnected: true,
      encomendas: {
        findMany: jest.fn(async () => [{ id: 99, id_condominio: 2 }]),
      },
    };
    const tenant: any = {
      assertCondominio: jest.fn(async (idCondominio: number, user?: JwtPayload) => {
        if (user?.id_condominio !== idCondominio) {
          throw new ForbiddenException('Acesso negado: condomínio inválido para esta sessão.');
        }
      }),
    };
    const service = new EncomendasService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      tenant,
    );
    return { service, prisma, tenant };
  }

  it('nega a listagem de encomendas de outro condomínio', async () => {
    const { service, prisma, tenant } = build();

    await expect(
      (service as any).findAll(2, undefined, operadorCond1),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(tenant.assertCondominio).toHaveBeenCalledWith(2, operadorCond1);
    expect(prisma.encomendas.findMany).not.toHaveBeenCalled();
  });
});
