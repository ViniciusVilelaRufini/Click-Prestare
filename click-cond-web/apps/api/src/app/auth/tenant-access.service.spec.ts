import { ForbiddenException } from '@nestjs/common';
import { TenantAccessService } from './tenant-access.service';
import type { JwtPayload } from './jwt-payload.interface';

/**
 * Contrato do helper central de autorização "mobile-aware".
 *
 * Diferente do assertSameTenant (que libera tokens sem id_condominio), este
 * resolve o vínculo de verdade conforme o tipo de token:
 *  - Porteiro/portaria-web: id_condominio fixo no JWT → compara direto.
 *  - Síndico mobile (sem id_condominio): valida via Sindicos_Condominios.
 *  - Morador mobile: valida via Apartamentos_Users (pertence ao condomínio).
 */
describe('TenantAccessService', () => {
  function build(overrides: Partial<any> = {}) {
    const prisma: any = {
      isConnected: true,
      sindicos_Condominios: { findFirst: jest.fn(async () => null) },
      apartamentos_Users: { findFirst: jest.fn(async () => null) },
      ...overrides,
    };
    return { svc: new TenantAccessService(prisma), prisma };
  }

  const porteiroCond1: JwtPayload = { sub: 1, nome: 'Porteiro', id_condominio: 1 };

  describe('assertCondominio', () => {
    it('porteiro: permite o próprio condomínio', async () => {
      const { svc } = build();
      await expect(svc.assertCondominio(1, porteiroCond1)).resolves.toBeUndefined();
    });

    it('porteiro: nega outro condomínio', async () => {
      const { svc } = build();
      await expect(svc.assertCondominio(2, porteiroCond1)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('sem payload (uso interno): não bloqueia', async () => {
      const { svc } = build();
      await expect(svc.assertCondominio(99)).resolves.toBeUndefined();
    });

    it('síndico mobile: permite se vinculado em Sindicos_Condominios', async () => {
      const { svc, prisma } = build({
        sindicos_Condominios: {
          findFirst: jest.fn(async ({ where }: any) =>
            where.id_user === 9 && where.id_condominio === 5 ? { id: 1 } : null,
          ),
        },
      });
      const sindico: JwtPayload = { sub: 9, nome: 'S', typeAccess: 'Sindico' };
      await expect(svc.assertCondominio(5, sindico)).resolves.toBeUndefined();
      expect(prisma.sindicos_Condominios.findFirst).toHaveBeenCalled();
    });

    it('síndico mobile: nega se NÃO vinculado', async () => {
      const { svc } = build();
      const sindico: JwtPayload = { sub: 9, nome: 'S', typeAccess: 'Sindico' };
      await expect(svc.assertCondominio(5, sindico)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('morador mobile: permite se tem apto no condomínio', async () => {
      const { svc } = build({
        apartamentos_Users: {
          findFirst: jest.fn(async ({ where }: any) =>
            where.id_user === 7 ? { id_apto: 100 } : null,
          ),
        },
      });
      const morador: JwtPayload = { sub: 7, nome: 'M' };
      await expect(svc.assertCondominio(5, morador)).resolves.toBeUndefined();
    });

    it('morador mobile: nega se não pertence ao condomínio', async () => {
      const { svc } = build();
      const morador: JwtPayload = { sub: 7, nome: 'M' };
      await expect(svc.assertCondominio(5, morador)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('assertEntidade', () => {
    it('valida o id_condominio da entidade contra o usuário', async () => {
      const { svc } = build();
      // porteiro do cond 1 tentando entidade do cond 2 → nega
      await expect(svc.assertEntidade(2, porteiroCond1)).rejects.toBeInstanceOf(ForbiddenException);
      // entidade do cond 1 → ok
      await expect(svc.assertEntidade(1, porteiroCond1)).resolves.toBeUndefined();
    });
  });
});
