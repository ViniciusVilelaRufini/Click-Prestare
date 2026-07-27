import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { VisitantesService } from './visitantes.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Cobre a autorização de tenant nos endpoints "globais" de visitantes
 * (check-in, liberar, check-out, get, detalhes, update) que NÃO passam pela
 * URL /condominios/:idCondominio e portanto escapam do TenantGuard.
 *
 * Um porteiro/síndico de um condomínio NÃO pode tocar visitante de outro.
 */
describe('VisitantesService — autorização de tenant (IDOR)', () => {
  // Visitante 500 pertence ao condomínio 2.
  const visitanteDoCond2 = {
    id: 500,
    id_condominio: 2,
    id_apartamento: 77,
    nome: 'Fulano',
    is_prestador: 0,
    face_id: null,
  };

  function buildService(overrides: Partial<any> = {}) {
    const prisma: any = {
      isConnected: true,
      visitantes: {
        findUnique: jest.fn(async ({ where }: any) =>
          where.id === 500 ? { ...visitanteDoCond2 } : null,
        ),
        update: jest.fn(async () => ({ ...visitanteDoCond2 })),
        updateMany: jest.fn(async () => ({ count: 1 })),
        create: jest.fn(async () => ({ ...visitanteDoCond2 })),
        findFirst: jest.fn(async () => null),
      },
      sindicos_Condominios: {
        findFirst: jest.fn(async () => null),
      },
      apartamentos_Users: {
        findMany: jest.fn(async () => []),
      },
      ...overrides,
    };
    const noop: any = { registrar: jest.fn(), sendPushNotification: jest.fn(), sendWhatsApp: jest.fn() };
    const facial: any = { syncVisitante: jest.fn().mockResolvedValue({}), unsyncVisitante: jest.fn() };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    // TenantAccessService real ligado ao mesmo mock de prisma: testa a
    // autorização ponta-a-ponta (porteiro/síndico via o helper central).
    const tenant = new TenantAccessService(prisma);
    const svc = new VisitantesService(prisma, noop, storage, facial, noop, tenant);
    return { svc, prisma };
  }

  const porteiroCond1: JwtPayload = { sub: 1, nome: 'Porteiro A', id_condominio: 1 };
  const porteiroCond2: JwtPayload = { sub: 2, nome: 'Porteiro B', id_condominio: 2 };

  describe('liberarAcesso', () => {
    it('NEGA porteiro de outro condomínio (efeito físico: abriria a porta)', async () => {
      const { svc, prisma } = buildService();
      await expect(svc.liberarAcesso(500, porteiroCond1)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.visitantes.update).not.toHaveBeenCalled();
    });

    it('PERMITE porteiro do mesmo condomínio', async () => {
      const { svc, prisma } = buildService();
      await svc.liberarAcesso(500, porteiroCond2);
      expect(prisma.visitantes.update).toHaveBeenCalled();
    });
  });

  describe('checkIn / checkOut', () => {
    it('checkIn nega cross-tenant', async () => {
      const { svc } = buildService();
      await expect(svc.checkIn(500, porteiroCond1)).rejects.toBeInstanceOf(ForbiddenException);
    });
    it('checkOut nega cross-tenant', async () => {
      const { svc } = buildService();
      await expect(svc.checkOut(500, porteiroCond1)).rejects.toBeInstanceOf(ForbiddenException);
    });
    it('checkOut de prestador mantém liberado=1, checkOut de visitante define liberado=0', async () => {
      // 1. Visitante
      const { svc, prisma } = buildService();
      await svc.checkOut(500, porteiroCond2);
      expect(prisma.visitantes.update).toHaveBeenCalledWith({
        where: { id: 500 },
        data: expect.objectContaining({ liberado: 0 }),
      });

      // 2. Prestador
      const { svc: svc2, prisma: prisma2 } = buildService({
        visitantes: {
          findUnique: jest.fn(async () => ({ ...visitanteDoCond2, is_prestador: 1 })),
          update: jest.fn(async () => ({ ...visitanteDoCond2, is_prestador: 1 })),
        },
      });
      await svc2.checkOut(500, porteiroCond2);
      expect(prisma2.visitantes.update).toHaveBeenCalledWith({
        where: { id: 500 },
        data: expect.objectContaining({ liberado: 1 }),
      });
    });
  });

  describe('findOne (GET /visitantes/get) e detalhes', () => {
    it('findOne nega cross-tenant (vazamento de doc/foto)', async () => {
      const { svc } = buildService();
      await expect(svc.findOne(500, porteiroCond1)).rejects.toBeInstanceOf(ForbiddenException);
    });
    it('findOne 404 para id inexistente', async () => {
      const { svc } = buildService();
      await expect(svc.findOne(999, porteiroCond2)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('nega editar visitante de outro condomínio', async () => {
      const { svc, prisma } = buildService();
      await expect(
        svc.update({ id: 500, nome: 'Hackeado' }, porteiroCond1),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.visitantes.update).not.toHaveBeenCalled();
    });
  });

  describe('síndico mobile (JWT sem id_condominio)', () => {
    it('NEGA síndico sem vínculo ao condomínio do visitante', async () => {
      const { svc } = buildService();
      const sindico: JwtPayload = { sub: 9, nome: 'Síndico X', typeAccess: 'Sindico' };
      await expect(svc.liberarAcesso(500, sindico)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('PERMITE síndico vinculado ao condomínio do visitante', async () => {
      const { svc, prisma } = buildService({
        sindicos_Condominios: {
          findFirst: jest.fn(async ({ where }: any) =>
            where.id_user === 9 && where.id_condominio === 2 ? { id: 1 } : null,
          ),
        },
      });
      const sindico: JwtPayload = { sub: 9, nome: 'Síndico X', typeAccess: 'Sindico' };
      await svc.liberarAcesso(500, sindico);
      expect(prisma.visitantes.update).toHaveBeenCalled();
    });
  });

  // A visita gera PIN de acesso e enrola no terminal facial. Se o morador
  // pudesse escolher o apartamento livremente, concederia entrada em nome da
  // unidade do vizinho.
  describe('apartamento de destino (create/update)', () => {
    const morador: JwtPayload = { sub: 7, nome: 'Morador Y', typeAccess: 'Morador' };

    function buildComApto(vinculoDoUsuario: boolean) {
      return buildService({
        apartamentos: {
          findUnique: jest.fn(async ({ where }: any) =>
            where.id === 77 ? { id: 77, id_condominio: 2 } : null,
          ),
        },
        apartamentos_Users: {
          findMany: jest.fn(async () => []),
          findFirst: jest.fn(async ({ where }: any) =>
            vinculoDoUsuario && where.id_user === 7 && where.id_apto === 77
              ? { id_apto: 77 }
              : null,
          ),
        },
      });
    }

    it('NEGA morador cadastrar visita em apartamento que não é dele', async () => {
      const { svc, prisma } = buildComApto(false);
      await expect(
        svc.create(
          { nome: 'Visita', id_apartamento: 77, id_condominio: 2 } as any,
          morador,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.visitantes.create).not.toHaveBeenCalled();
    });

    it('NEGA morador mover a própria visita para o apartamento do vizinho', async () => {
      const { svc, prisma } = buildComApto(false);
      await expect(
        svc.update({ id: 500, id_apartamento: 77 } as any, morador),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.visitantes.update).not.toHaveBeenCalled();
    });
  });
});
