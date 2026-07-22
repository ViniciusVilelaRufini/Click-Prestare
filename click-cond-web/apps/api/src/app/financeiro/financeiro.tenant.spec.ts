import { ForbiddenException } from '@nestjs/common';
import { FinanceiroService } from './financeiro.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Prova de que a migração de assertSameTenant (tenant.util.ts, no-op para
 * JWT mobile sem id_condominio) para TenantAccessService (resolve o vínculo
 * de verdade via banco) fecha o vazamento cross-tenant do módulo financeiro.
 *
 * Antes desta correção, qualquer usuário logado pelo app (Síndico, Morador
 * ou Funcionário — nenhum desses tokens carrega id_condominio) conseguia
 * ler/remover/marcar como pago lançamentos de QUALQUER condomínio.
 */
describe('FinanceiroService — isolamento de tenant (IDOR)', () => {
  // Lançamento 500 pertence ao condomínio 2.
  const lancamentoDoCond2 = {
    id: 500,
    id_condominio: 2,
    nome: 'Conta de luz',
    valor: 250,
    tipo: 'D',
    pago: 0,
    status: '0',
    id_usuario: null,
    data: new Date('2026-06-01'),
    data_vencimento: new Date('2026-06-10'),
  };

  function buildService(overrides: Partial<any> = {}) {
    const prisma: any = {
      isConnected: true,
      financeiro: {
        findUnique: jest.fn(async ({ where }: any) =>
          where.id === 500 ? { ...lancamentoDoCond2 } : null,
        ),
        findFirst: jest.fn(async ({ where }: any) =>
          where.id === 500 && where.id_condominio === 2 ? { ...lancamentoDoCond2 } : null,
        ),
        update: jest.fn(async () => ({ ...lancamentoDoCond2 })),
        delete: jest.fn(async () => ({ ...lancamentoDoCond2 })),
      },
      sindicos_Condominios: { findFirst: jest.fn(async () => null) },
      apartamentos_Users: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
      moradores: { findMany: jest.fn(async () => []) },
      ...overrides,
    };
    const noop: any = { registrar: jest.fn() };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const fechamento: any = { assertPodeAlterar: jest.fn(async () => undefined) };
    const openPix: any = { generateCharge: jest.fn() };
    // TenantAccessService real ligado ao mesmo mock de prisma: testa a
    // autorização ponta-a-ponta via o helper mobile-aware central.
    const tenant = new TenantAccessService(prisma);
    const svc = new FinanceiroService(prisma, storage, noop, noop, noop, fechamento, openPix, tenant);
    return { svc, prisma };
  }

  const porteiroCond1: JwtPayload = { sub: 1, nome: 'Porteiro A', id_condominio: 1 };
  const porteiroCond2: JwtPayload = { sub: 2, nome: 'Porteiro B', id_condominio: 2 };

  describe('remove', () => {
    it('NEGA porteiro de outro condomínio', async () => {
      const { svc, prisma } = buildService();
      await expect(svc.remove(500, porteiroCond1)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.financeiro.delete).not.toHaveBeenCalled();
    });

    it('PERMITE porteiro do mesmo condomínio', async () => {
      const { svc, prisma } = buildService();
      await svc.remove(500, porteiroCond2);
      expect(prisma.financeiro.delete).toHaveBeenCalledWith({ where: { id: 500 } });
    });
  });

  describe('updateStatus', () => {
    it('NEGA porteiro de outro condomínio marcar como pago', async () => {
      const { svc, prisma } = buildService();
      await expect(svc.updateStatus(500, '1', porteiroCond1)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.financeiro.update).not.toHaveBeenCalled();
    });
  });

  describe('get (GET /financeiro/get)', () => {
    it('NEGA leitura cross-tenant — vazamento de valor/categoria/comprovante', async () => {
      const { svc } = buildService();
      await expect(svc.get(2, 500, porteiroCond1)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('PERMITE leitura quando o operador pertence ao condomínio do lançamento', async () => {
      const { svc } = buildService();
      const result = await svc.get(2, 500, porteiroCond2);
      expect(result.id).toBe(500);
    });
  });

  describe('síndico e morador mobile (JWT sem id_condominio)', () => {
    it('NEGA síndico mobile sem vínculo ao condomínio do lançamento', async () => {
      const { svc } = buildService();
      const sindico: JwtPayload = { sub: 9, nome: 'Síndico X', typeAccess: 'Sindico' };
      await expect(svc.remove(500, sindico)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('PERMITE síndico mobile vinculado ao condomínio do lançamento (via Sindicos_Condominios)', async () => {
      const { svc, prisma } = buildService({
        sindicos_Condominios: {
          findFirst: jest.fn(async ({ where }: any) =>
            where.id_user === 9 && where.id_condominio === 2 ? { id: 1 } : null,
          ),
        },
      });
      const sindico: JwtPayload = { sub: 9, nome: 'Síndico X', typeAccess: 'Sindico' };
      await svc.remove(500, sindico);
      expect(prisma.financeiro.delete).toHaveBeenCalled();
    });

    it('NEGA morador mobile sem apartamento no condomínio do lançamento', async () => {
      const { svc } = buildService();
      const morador: JwtPayload = { sub: 7, nome: 'Morador Y', typeAccess: 'Morador' };
      await expect(svc.get(2, 500, morador)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
