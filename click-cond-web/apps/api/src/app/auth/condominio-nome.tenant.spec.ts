import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { IS_PUBLIC_KEY } from './public.decorator';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

/**
 * GET /auth/condominio/:id era público e devolvia o nome do condomínio para
 * qualquer id. Como o id é sequencial, dava para listar todos os clientes da
 * plataforma. O único consumidor é a portaria-web JÁ LOGADA, recuperando o
 * nome do próprio condomínio — então a rota exige token e confere o vínculo.
 */
describe('GET /auth/condominio/:id — exige sessão do próprio condomínio', () => {
  function build() {
    const prisma: any = {
      isConnected: true,
      condominios: { findUnique: jest.fn().mockResolvedValue({ nome: 'Boa Vista' }) },
    };
    const tenant: any = {
      assertCondominio: jest.fn(async (id: number, payload: any) => {
        if (payload.id_condominio !== id) throw new ForbiddenException('outro condomínio');
      }),
    };
    const service = new AuthService(prisma, {} as any, {} as any, tenant);
    return { service, prisma };
  }

  it('a rota não é pública', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AuthController.prototype.getCondominio)).toBeFalsy();
  });

  it('sem sessão é recusado', async () => {
    const { service, prisma } = build();
    await expect(service.getCondominioNome(2, undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.condominios.findUnique).not.toHaveBeenCalled();
  });

  it('sessão de outro condomínio é recusada', async () => {
    const { service, prisma } = build();
    await expect(service.getCondominioNome(2, { id_condominio: 1 } as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.condominios.findUnique).not.toHaveBeenCalled();
  });

  it('sessão do próprio condomínio recebe o nome', async () => {
    const { service } = build();
    await expect(service.getCondominioNome(2, { id_condominio: 2 } as any)).resolves.toEqual({ nome: 'Boa Vista' });
  });
});
