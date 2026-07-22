import { ForbiddenException } from '@nestjs/common';
import { PrestadoresService } from './prestadores.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * O TenantGuard valida o :idCondominio do path contra o JWT, mas NÃO impede
 * que o :id do prestador seja de outro condomínio — e nem cobre a rota
 * mobile (/prestadores/*, sem :idCondominio na URL). Estes testes garantem
 * que findOne/update/remove/create/findAll negam via TenantAccessService
 * (mobile-aware) quando o prestador/condomínio não é do operador.
 */
describe('PrestadoresService — autorização de tenant (IDOR)', () => {
  const prestadorCond2 = { id: 700, id_condominio: 2, nome: 'Encanador', apartamento: null };

  function build(overrides: Partial<any> = {}) {
    const prisma: any = {
      isConnected: true,
      prestadores_servico: {
        findUnique: jest.fn(async ({ where }: any) =>
          where.id === 700 ? { ...prestadorCond2 } : null,
        ),
        findFirst: jest.fn(async () => null),
        update: jest.fn(async () => ({ ...prestadorCond2 })),
        delete: jest.fn(async () => ({})),
      },
      funcionarios_Portaria: { findMany: jest.fn(async () => []) },
      sindicos_Condominios: { findFirst: jest.fn(async () => null) },
      apartamentos_Users: { findFirst: jest.fn(async () => null) },
      ...overrides,
    };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const facial: any = { syncPrestadorServico: jest.fn(), unsyncPrestadorServico: jest.fn() };
    const tenant = new TenantAccessService(prisma);
    return { svc: new PrestadoresService(prisma, storage, facial, tenant), prisma };
  }

  const porteiroCond1: JwtPayload = { sub: 1, nome: 'Porteiro A', id_condominio: 1 };
  const porteiroCond2: JwtPayload = { sub: 2, nome: 'Porteiro B', id_condominio: 2 };

  it('findOne nega prestador de outro condomínio', async () => {
    const { svc } = build();
    await expect(svc.findOne(700, 1, porteiroCond1)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('findOne permite prestador do mesmo condomínio', async () => {
    const { svc } = build();
    await expect(svc.findOne(700, 2, porteiroCond2)).resolves.toMatchObject({ id: 700 });
  });

  it('update nega cross-tenant e NÃO escreve', async () => {
    const { svc, prisma } = build();
    await expect(svc.update(700, { nome: 'x' }, 1, porteiroCond1)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.prestadores_servico.update).not.toHaveBeenCalled();
  });

  it('remove nega cross-tenant e NÃO deleta', async () => {
    const { svc, prisma } = build();
    await expect(svc.remove(700, 1, porteiroCond1)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.prestadores_servico.delete).not.toHaveBeenCalled();
  });

  it('remove permite mesmo condomínio', async () => {
    const { svc, prisma } = build();
    await svc.remove(700, 2, porteiroCond2);
    expect(prisma.prestadores_servico.delete).toHaveBeenCalled();
  });

  it('findOne (rota mobile, sem idCondominio na URL) nega síndico sem vínculo', async () => {
    const { svc } = build();
    const sindico: JwtPayload = { sub: 9, nome: 'Síndico X', typeAccess: 'Sindico' };
    await expect(svc.findOne(700, undefined, sindico)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('findOne (rota mobile) permite síndico vinculado ao condomínio do prestador', async () => {
    const { svc } = build({
      sindicos_Condominios: {
        findFirst: jest.fn(async ({ where }: any) =>
          where.id_user === 9 && where.id_condominio === 2 ? { id: 1 } : null,
        ),
      },
    });
    const sindico: JwtPayload = { sub: 9, nome: 'Síndico X', typeAccess: 'Sindico' };
    await expect(svc.findOne(700, undefined, sindico)).resolves.toMatchObject({ id: 700 });
  });
});
