import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { FacialService } from './facial.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * O módulo facial usava `assertSameTenant` (tenant.util), que se AUTO-DESLIGA
 * quando o JWT não tem `id_condominio`:
 *
 *     if (!user?.id_condominio) return;   // "síndico mobile"
 *
 * Nenhum token do app carrega id_condominio. Então, para morador, síndico e
 * funcionário do app, a checagem era um NO-OP: bastava trocar o id na URL
 * para ler o histórico de entradas e saídas de qualquer pessoa — inclusive de
 * outro condomínio.
 *
 * Histórico de acesso é registro de ir e vir. Estar no mesmo prédio não dá
 * direito a ele: morador vê o próprio, e as visitas do apartamento dele.
 */
describe('FacialService — histórico de acesso por pessoa', () => {
  const MEU_USER = 50;
  const MEU_APTO = 7;

  const morador: JwtPayload = { sub: MEU_USER, nome: 'Morador', typeAccess: 'Morador' };
  const sindico: JwtPayload = { sub: 51, nome: 'Síndico', typeAccess: 'Sindico' };
  const porteiro: JwtPayload = { sub: 52, nome: 'Porteiro', id_condominio: 1 };

  // O construtor do FacialService arma setTimeout/setInterval de
  // re-sincronização; sem isto o Jest não encerra. Mesma convenção dos
  // specs vizinhos (lpr.spec.ts, reserva-area.spec.ts).
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function build() {
    const prisma: any = {
      isConnected: true,
      moradores: {
        findUnique: jest.fn(async ({ where }: any) => {
          if (where.id === 100) return { id_condominio: 1, id_user: MEU_USER }; // eu
          if (where.id === 101) return { id_condominio: 1, id_user: 999 };      // vizinho
          if (where.id === 200) return { id_condominio: 2, id_user: 999 };      // outro prédio
          return null;
        }),
      },
      visitantes: {
        findUnique: jest.fn(async ({ where }: any) => {
          if (where.id === 300) return { id_condominio: 1, id_apartamento: MEU_APTO };
          if (where.id === 301) return { id_condominio: 1, id_apartamento: 8 };
          return null;
        }),
      },
      apartamentos_Users: {
        findFirst: jest.fn(async ({ where }: any) => {
          if (where.id_user !== MEU_USER) return null;
          if (where.id_apto !== undefined) {
            return where.id_apto === MEU_APTO ? { id_apto: MEU_APTO } : null;
          }
          // Consulta do TenantAccessService: pertence ao condomínio 1.
          return where.apartamento?.id_condominio === 1 ? { id_apto: MEU_APTO } : null;
        }),
      },
      sindicos_Condominios: {
        findFirst: jest.fn(async ({ where }: any) =>
          where.id_condominio === 1 ? { id: 1 } : null,
        ),
      },
    };
    const tenant = new TenantAccessService(prisma);
    const svc = new FacialService(
      prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, tenant,
    );
    return { svc };
  }

  describe('morador', () => {
    it('NEGA ler o histórico de um vizinho', async () => {
      const { svc } = build();
      await expect(svc.assertMoradorSameTenant(101, morador))
        .rejects.toBeInstanceOf(ForbiddenException);
    });

    it('NEGA ler histórico de morador de OUTRO condomínio (era no-op antes)', async () => {
      const { svc } = build();
      await expect(svc.assertMoradorSameTenant(200, morador)).rejects.toThrow();
    });

    it('PERMITE ler o próprio histórico', async () => {
      const { svc } = build();
      await expect(svc.assertMoradorSameTenant(100, morador)).resolves.toBeUndefined();
    });

    it('NEGA visita de apartamento que não é dele', async () => {
      const { svc } = build();
      await expect(svc.assertVisitanteSameTenant(301, morador))
        .rejects.toBeInstanceOf(ForbiddenException);
    });

    it('PERMITE visita do próprio apartamento', async () => {
      const { svc } = build();
      await expect(svc.assertVisitanteSameTenant(300, morador)).resolves.toBeUndefined();
    });
  });

  describe('quem administra segue com alcance no condomínio', () => {
    it('síndico lê o histórico de qualquer morador do prédio dele', async () => {
      const { svc } = build();
      await expect(svc.assertMoradorSameTenant(101, sindico)).resolves.toBeUndefined();
    });

    it('porteiro lê qualquer visita do condomínio dele', async () => {
      const { svc } = build();
      await expect(svc.assertVisitanteSameTenant(301, porteiro)).resolves.toBeUndefined();
    });

    it('síndico NÃO alcança outro condomínio', async () => {
      const { svc } = build();
      await expect(svc.assertMoradorSameTenant(200, sindico)).rejects.toThrow();
    });
  });

  it('pessoa inexistente continua 404', async () => {
    const { svc } = build();
    await expect(svc.assertMoradorSameTenant(999, porteiro))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});
