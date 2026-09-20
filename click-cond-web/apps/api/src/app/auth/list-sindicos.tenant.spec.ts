import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { MobileAuthService } from './mobile-auth.service';
import { AreasSociaisService } from '../areas-sociais/areas-sociais.service';
import { TenantAccessService } from './tenant-access.service';
import type { JwtPayload } from './jwt-payload.interface';

/**
 * Duas rotas ficaram sem isolamento de tenant na unificação Express→NestJS
 * e na migração para a AWS. O TenantGuard global NÃO cobre nenhuma das duas:
 * ele só valida o route param `:idCondominio` (tenant.guard.ts), e aqui o
 * condomínio chega por query string.
 *
 * 1) GET /api/sindico/list-sindicos?id_condominio=N
 *    Não recebia o usuário logado. Qualquer autenticado iterava N e extraía
 *    nome + e-mail dos síndicos de todos os condomínios da base.
 *
 * 2) GET /api/areas-sociais/manutencoes/get-all
 *    O assert existia, mas atrás de `if (idCondominio)`. Omitindo o
 *    parâmetro, Number(undefined) = NaN (falsy): o assert era pulado e o
 *    `where` saía vazio, devolvendo as manutenções de todos os condomínios.
 *
 * Os testes ligam o TenantAccessService REAL ao mesmo mock de prisma, então
 * exercitam a autorização ponta-a-ponta — um mock do assert passaria mesmo
 * se a chamada fosse removida do service.
 */
describe('Isolamento de tenant em rotas com id_condominio por query string', () => {
  // Morador vinculado ao condomínio 1 — token mobile, sem id_condominio.
  const moradorCond1: JwtPayload = { sub: 77, nome: 'Morador do cond 1' };

  describe('MobileAuthService.listSindicosByCondominio', () => {
    function build() {
      const prisma: any = {
        isConnected: true,
        sindicos_Condominios: {
          // Vínculo real: user 77 NÃO é síndico de lugar nenhum.
          findFirst: jest.fn(async () => null),
          findMany: jest.fn(async () => [
            {
              id_user: 9,
              user: { id: 9, email: 'sindico@cond2.com', sindicos: [{ name: 'Síndico do 2', email: 'sindico@cond2.com' }] },
            },
          ]),
        },
        // Morador 77 mora no condomínio 1 (e só nele).
        apartamentos_Users: {
          findFirst: jest.fn(async ({ where }: any) => {
            const cond = where?.apartamento?.id_condominio;
            return cond === 1 ? { id: 1, id_user: 77 } : null;
          }),
          findMany: jest.fn(async () => []),
        },
        funcionarios: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
      };
      const tenant = new TenantAccessService(prisma);
      const svc = new MobileAuthService(
        prisma,
        null as any, null as any, null as any, null as any,
        tenant,
        null as any, null as any, null as any, null as any,
      );
      return { svc, prisma };
    }

    it('bloqueia morador do cond 1 tentando listar síndicos do cond 2', async () => {
      const { svc, prisma } = build();

      await expect(svc.listSindicosByCondominio(2, moradorCond1)).rejects.toThrow(ForbiddenException);

      // A query nem chega a rodar: o vazamento é barrado antes do banco.
      expect(prisma.sindicos_Condominios.findMany).not.toHaveBeenCalled();
    });

    it('permite o morador listar os síndicos do próprio condomínio', async () => {
      const { svc, prisma } = build();

      await expect(svc.listSindicosByCondominio(1, moradorCond1)).resolves.toEqual([
        { id_user: 9, nome: 'Síndico do 2', email: 'sindico@cond2.com' },
      ]);
      expect(prisma.sindicos_Condominios.findMany).toHaveBeenCalled();
    });
  });

  describe('AreasSociaisService.getAllManutencoes', () => {
    function build() {
      const prisma: any = {
        isConnected: true,
        areas_Sociais_Manutencoes: {
          findMany: jest.fn(async () => [{ id: 900, area: { id: 30, nome: 'Salão', id_condominio: 2 } }]),
        },
        sindicos_Condominios: { findFirst: jest.fn(async () => null) },
        apartamentos_Users: {
          findFirst: jest.fn(async ({ where }: any) =>
            where?.apartamento?.id_condominio === 1 ? { id: 1, id_user: 77 } : null,
          ),
          findMany: jest.fn(async () => []),
        },
        funcionarios: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
      };
      const tenant = new TenantAccessService(prisma);
      const svc = new AreasSociaisService(prisma, null as any, null as any, null as any, tenant);
      return { svc, prisma };
    }

    it('recusa a chamada sem id_condominio em vez de devolver todos os condomínios', async () => {
      const { svc, prisma } = build();

      await expect(svc.getAllManutencoes(undefined as any, undefined, moradorCond1)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.areas_Sociais_Manutencoes.findMany).not.toHaveBeenCalled();
    });

    it('não deixa passar só id_area_social para alcançar área de outro condomínio', async () => {
      const { svc, prisma } = build();

      await expect(svc.getAllManutencoes(undefined as any, 30, moradorCond1)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.areas_Sociais_Manutencoes.findMany).not.toHaveBeenCalled();
    });

    it('bloqueia morador do cond 1 pedindo manutenções do cond 2', async () => {
      const { svc, prisma } = build();

      await expect(svc.getAllManutencoes(2, undefined, moradorCond1)).rejects.toThrow(ForbiddenException);
      expect(prisma.areas_Sociais_Manutencoes.findMany).not.toHaveBeenCalled();
    });

    it('sempre escopa a consulta pelo condomínio autorizado', async () => {
      const { svc, prisma } = build();

      await svc.getAllManutencoes(1, undefined, moradorCond1);

      const where = prisma.areas_Sociais_Manutencoes.findMany.mock.calls[0][0].where;
      expect(where).toEqual({ area: { id_condominio: 1 } });
    });
  });
});
