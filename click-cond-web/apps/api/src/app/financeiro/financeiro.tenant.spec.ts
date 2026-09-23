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
        create: jest.fn(async () => ({ ...lancamentoDoCond2 })),
      },
      sindicos_Condominios: { findFirst: jest.fn(async () => null) },
      apartamentos_Users: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
      moradores: { findMany: jest.fn(async () => []) },
      ...overrides,
    };
    const noop: any = { registrar: jest.fn() };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const fechamento: any = { assertPodeAlterar: jest.fn(async () => undefined) };
    // TenantAccessService real ligado ao mesmo mock de prisma: testa a
    // autorização ponta-a-ponta via o helper mobile-aware central.
    const tenant = new TenantAccessService(prisma);
    const svc = new FinanceiroService(prisma, storage, noop, noop, noop, fechamento, tenant);
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

    it('NEGA porteiro ler conta pessoal de morador (id_usuario preenchido)', async () => {
      const contaPessoal = { ...lancamentoDoCond2, id: 501, id_usuario: 7, tipo: 'D' };
      const { svc } = buildService({
        financeiro: {
          findFirst: jest.fn(async ({ where }: any) =>
            where.id === 501 && where.id_condominio === 2 ? contaPessoal : null,
          ),
        },
      });
      await expect(svc.get(2, 501, porteiroCond2)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('NEGA porteiro inspecionar cobrança individual de unidade (tipo C)', async () => {
      const cobrancaUnidade = { ...lancamentoDoCond2, id: 502, tipo: 'C', nome: 'Apto 101 Bloco A - Ref. 05/2026' };
      const { svc } = buildService({
        financeiro: {
          findFirst: jest.fn(async ({ where }: any) =>
            where.id === 502 && where.id_condominio === 2 ? cobrancaUnidade : null,
          ),
        },
      });
      await expect(svc.get(2, 502, porteiroCond2)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('PERMITE morador ler a própria conta pessoal com sub string do JWT', async () => {
      const contaPessoal = { ...lancamentoDoCond2, id: 503, id_usuario: 7, tipo: 'D' };
      const { svc } = buildService({
        financeiro: {
          findFirst: jest.fn(async ({ where }: any) =>
            where.id === 503 && where.id_condominio === 2 ? contaPessoal : null,
          ),
        },
        apartamentos_Users: {
          findFirst: jest.fn(async () => ({ id_apto: 10 })),
          findMany: jest.fn(async () => []),
        },
        moradores: {
          findMany: jest.fn(async () => [{ apartamento: '101', bloco: 'A' }]),
        },
      });
      const morador: JwtPayload = { sub: '7' as any, nome: 'Morador 7', typeAccess: 'Morador' };
      const result = await svc.get(2, 503, morador);
      expect(result.id).toBe(503);
    });

    it('NEGA morador ler conta pessoal de outro usuário', async () => {
      const contaAlheia = { ...lancamentoDoCond2, id: 504, id_usuario: 8, tipo: 'D' };
      const { svc } = buildService({
        financeiro: {
          findFirst: jest.fn(async ({ where }: any) =>
            where.id === 504 && where.id_condominio === 2 ? contaAlheia : null,
          ),
        },
        apartamentos_Users: {
          findFirst: jest.fn(async () => ({ id_apto: 10 })),
          findMany: jest.fn(async () => []),
        },
        moradores: {
          findMany: jest.fn(async () => [{ apartamento: '101', bloco: 'A' }]),
        },
      });
      const morador: JwtPayload = { sub: '7' as any, nome: 'Morador 7', typeAccess: 'Morador' };
      await expect(svc.get(2, 504, morador)).rejects.toBeInstanceOf(ForbiddenException);
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

  describe('getByUser (GET /financeiro/get-by-user)', () => {
    it('NEGA staff lendo o financeiro de condomínio que não é o dele', async () => {
      const { svc } = buildService();
      await expect(svc.getByUser(1, 2, porteiroCond1)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('PERMITE staff do próprio condomínio', async () => {
      const { svc } = buildService({
        financeiro: {
          findMany: jest.fn(async () => []),
          findUnique: jest.fn(async () => null),
          findFirst: jest.fn(async () => null),
        },
        condominios: { findUnique: jest.fn(async () => ({ chave_pix: '' })) },
      });
      await expect(svc.getByUser(1, 2, porteiroCond2)).resolves.toEqual([]);
    });
  });

  describe('uploadSharedFile', () => {
    // Cobrança de condomínio não tem id_usuario; sem checar o apartamento,
    // o morador sobrescrevia o comprovante da unidade do vizinho.
    it('NEGA morador anexar em cobrança que não é da unidade dele', async () => {
      const { svc, prisma } = buildService({
        apartamentos_Users: {
          findFirst: jest.fn(async () => ({ id_apto: 10 })),
          findMany: jest.fn(async () => []),
        },
      });
      const morador: JwtPayload = { sub: 7, nome: 'Morador Y', typeAccess: 'Morador' };
      await expect(
        svc.uploadSharedFile(500, 'data:image/png;base64,AAA', 'comprovante', morador),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.financeiro.update).not.toHaveBeenCalled();
    });

    // Token da portaria-web: `sub` é Funcionarios_Portaria.id, não Users.id.
    // Com o mesmo número do dono da conta, o porteiro passava na checagem
    // de posse e trocava o comprovante do morador.
    it('NEGA porteiro cujo id coincide com o do dono da conta', async () => {
      const { svc, prisma } = buildService({
        financeiro: {
          findUnique: jest.fn(async () => ({ ...lancamentoDoCond2, id_usuario: 2 })),
          update: jest.fn(async () => ({})),
        },
      });
      await expect(
        svc.uploadSharedFile(500, 'data:image/png;base64,AAA', 'comprovante', porteiroCond2),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.financeiro.update).not.toHaveBeenCalled();
    });
  });

  describe('insertMoradorConta', () => {
    it('NEGA criar conta pessoal dentro de condomínio alheio', async () => {
      const { svc, prisma } = buildService();
      const morador: JwtPayload = { sub: 7, nome: 'Morador Y', typeAccess: 'Morador' };
      await expect(
        svc.insertMoradorConta(7, 2, { nome: 'Luz', valor: 100 }, morador),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.financeiro.create).not.toHaveBeenCalled();
    });
  });
});
