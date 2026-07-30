import { ForbiddenException } from '@nestjs/common';
import { ApartamentosController } from './apartamentos.controller';
import { MobileAuthService } from '../auth/mobile-auth.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

const morador: JwtPayload = { sub: 50, nome: 'Morador', typeAccess: 'Morador' };
const sindico: JwtPayload = { sub: 51, nome: 'Síndico', typeAccess: 'Sindico' };
const porteiro: JwtPayload = { sub: 52, nome: 'Porteiro', id_condominio: 1 };

/**
 * A listagem de apartamentos do app devolve, junto de cada unidade, o campo
 * `moradores` com os NOMES de quem mora nela — na prática um diretório de
 * "quem mora onde" do prédio inteiro.
 *
 * É seletor de apartamento das telas de staff: no app, todo chamador faz
 * `if (morador) usa o próprio apto; else carrega a lista`. A restrição existia
 * em cinco telas do Flutter e em nenhum lugar do servidor.
 */
describe('Listagem de apartamentos — exige operador', () => {
  describe('/apartamentos/get-all (app)', () => {
    function build() {
      const prisma: any = {
        isConnected: true,
        apartamentos: { findMany: jest.fn(async () => []) },
        apartamentos_Users: { findFirst: jest.fn(async () => ({ id_apto: 7 })) },
        sindicos_Condominios: { findFirst: jest.fn(async () => ({ id: 1 })) },
      };
      const tenant = new TenantAccessService(prisma);
      const svc = new MobileAuthService(
        prisma, { sign: jest.fn() } as any, {} as any, {} as any, {} as any, tenant, {} as any, {} as any,
      );
      return { svc, prisma };
    }

    it('NEGA morador — a lista revela quem mora em cada unidade', async () => {
      const { svc, prisma } = build();
      await expect(svc.getAllApartamentos(1, morador)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.apartamentos.findMany).not.toHaveBeenCalled();
    });

    it('PERMITE síndico', async () => {
      const { svc, prisma } = build();
      await svc.getAllApartamentos(1, sindico);
      expect(prisma.apartamentos.findMany).toHaveBeenCalled();
    });

    it('PERMITE porteiro da portaria-web', async () => {
      const { svc, prisma } = build();
      await svc.getAllApartamentos(1, porteiro);
      expect(prisma.apartamentos.findMany).toHaveBeenCalled();
    });
  });

  describe('condominios/:id/apartamentos (console)', () => {
    function build() {
      const service: any = { findAll: jest.fn(async () => []) };
      return { ctrl: new ApartamentosController(service), service };
    }

    it('NEGA morador', () => {
      const { ctrl, service } = build();
      expect(() => ctrl.list(1, morador)).toThrow(ForbiddenException);
      expect(service.findAll).not.toHaveBeenCalled();
    });

    it('PERMITE operador', () => {
      const { ctrl, service } = build();
      ctrl.list(1, porteiro);
      expect(service.findAll).toHaveBeenCalled();
    });
  });
});

/**
 * Havia DUAS implementações da exclusão de apartamento — a do console e a do
 * app — e elas já tinham divergido: a primeira conta o que a cascata leva
 * junto e audita; a segunda apagava calada e respondia "não encontrado" para
 * qualquer falha. O app passa a delegar, então existe uma cópia só.
 */
describe('removeApto do app delega para o ApartamentosService', () => {
  it('usa a implementação única, com contagem da cascata', async () => {
    const apartamentos: any = {
      remove: jest.fn(async () => ({ success: true, arrastados: { visitantes: 7 } })),
    };
    const prisma: any = { isConnected: true };
    const svc = new MobileAuthService(
      prisma, { sign: jest.fn() } as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, apartamentos,
    );

    const r: any = await svc.removeApto(5, sindico);
    expect(apartamentos.remove).toHaveBeenCalledWith(5, sindico);
    expect(r.arrastados.visitantes).toBe(7);
  });
});
