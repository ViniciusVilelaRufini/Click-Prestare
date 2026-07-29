import { ForbiddenException } from '@nestjs/common';
import { TenantAccessService } from './tenant-access.service';
import type { JwtPayload } from './jwt-payload.interface';

/**
 * O vínculo do funcionário do app é ser da EQUIPE do condomínio (tabela
 * Funcionarios), não morar nele. Como o assertCondominio só tinha ramo para
 * síndico (Sindicos_Condominios) e morador (Apartamentos_Users), o funcionário
 * caía na regra do morador e levava 403 em TUDO que passa por aqui — o módulo
 * financeiro inteiro, entre outros.
 *
 * Na produção, 4 dos 6 funcionários cadastrados não têm apartamento; os 2 que
 * funcionavam só passavam por acaso, porque também eram morador ou síndico.
 */
describe('TenantAccessService — vínculo do funcionário', () => {
  function build(overrides: any = {}) {
    const prisma: any = {
      isConnected: true,
      sindicos_Condominios: { findFirst: jest.fn(async () => null) },
      apartamentos_Users: { findFirst: jest.fn(async () => null) },
      funcionarios: { findFirst: jest.fn(async () => null) },
      ...overrides,
    };
    return { service: new TenantAccessService(prisma), prisma };
  }

  const funcionario: JwtPayload = { sub: 46, nome: 'Jorge', typeAccess: 'Funcionario' };

  it('PERMITE funcionário no condomínio onde ele trabalha (sem apartamento)', async () => {
    const { service, prisma } = build({
      funcionarios: { findFirst: jest.fn(async () => ({ id: 4 })) },
    });

    await expect(service.assertCondominio(4, funcionario)).resolves.toBeUndefined();
    expect(prisma.funcionarios.findFirst).toHaveBeenCalledWith({
      where: { id_user: 46, id_condominio: 4 },
      select: { id: true },
    });
    // Não deve exigir vínculo de morador para liberar.
    expect(prisma.apartamentos_Users.findFirst).not.toHaveBeenCalled();
  });

  it('NEGA funcionário em condomínio onde ele NÃO trabalha', async () => {
    const { service } = build({
      funcionarios: { findFirst: jest.fn(async () => null) },
    });
    await expect(service.assertCondominio(99, funcionario)).rejects.toThrow(ForbiddenException);
  });

  it('não afeta o morador: continua validando por apartamento', async () => {
    const morador: JwtPayload = { sub: 10, nome: 'Morador', typeAccess: 'Morador' };
    const { service, prisma } = build({
      apartamentos_Users: { findFirst: jest.fn(async () => ({ id_apto: 1 })) },
    });

    await expect(service.assertCondominio(1, morador)).resolves.toBeUndefined();
    expect(prisma.apartamentos_Users.findFirst).toHaveBeenCalled();
    expect(prisma.funcionarios.findFirst).not.toHaveBeenCalled();
  });

  it('não afeta o síndico: continua validando por Sindicos_Condominios', async () => {
    const sindico: JwtPayload = { sub: 42, nome: 'Síndico', typeAccess: 'Sindico' };
    const { service, prisma } = build({
      sindicos_Condominios: { findFirst: jest.fn(async () => ({ id: 1 })) },
    });

    await expect(service.assertCondominio(1, sindico)).resolves.toBeUndefined();
    expect(prisma.sindicos_Condominios.findFirst).toHaveBeenCalled();
    expect(prisma.funcionarios.findFirst).not.toHaveBeenCalled();
  });

  // O ramo do funcionário não pode virar um atalho para o token da portaria:
  // esse continua sendo resolvido pela comparação direta de id_condominio.
  it('token da portaria-web continua preso ao condomínio do próprio token', async () => {
    const portaria: JwtPayload = { sub: 9, nome: 'Portaria', id_condominio: 2 };
    const { service } = build({
      funcionarios: { findFirst: jest.fn(async () => ({ id: 1 })) },
    });

    await expect(service.assertCondominio(2, portaria)).resolves.toBeUndefined();
    await expect(service.assertCondominio(5, portaria)).rejects.toThrow(ForbiddenException);
  });
});
