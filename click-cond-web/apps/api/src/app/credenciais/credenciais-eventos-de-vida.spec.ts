/**
 * Credenciais de morador (QR do app e passes da carteira) nos eventos de vida da conta (W2, R6):
 * unidade tirada no console, unidade apagada e troca/redefinição de senha. Prisma simulado.
 */
import { ApartamentosService } from '../apartamentos/apartamentos.service';
import { MoradoresService } from '../moradores/moradores.service';
import { MobileAuthService } from '../auth/mobile-auth.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import {
  moradoresSemUnidadeNoCondominio,
  revogarCredenciaisSemUnidade,
} from './credencial-morador-vigencia.util';

const SINDICO: JwtPayload = { sub: 1, nome: 'Síndico', typeAccess: 'Sindico', id_condominio: 1 };

describe('credenciais nos eventos de vida da conta', () => {
  describe('util', () => {
    it('só as linhas de quem ficou sem unidade no condomínio', async () => {
      const prisma: any = {
        // Conta 8 ainda mora em outra unidade do condomínio 1.
        apartamentos_Users: { findFirst: jest.fn(async ({ where }: any) => (where.id_user === 8 ? { id_apto: 9 } : null)) },
        moradores: {
          findMany: jest.fn(async ({ where }: any) => (where.id_user === 7 ? [{ id: 11 }, { id: 14 }] : [{ id: 13 }])),
        },
      };

      expect(await moradoresSemUnidadeNoCondominio(prisma, [7, 8, 7], 1)).toEqual([11, 14]);
      expect(prisma.apartamentos_Users.findFirst).toHaveBeenCalledWith({
        where: { id_user: 7, apartamento: { id_condominio: 1, condominio: { ativo: 1 } } },
        select: { id_apto: true },
      });
      expect(prisma.moradores.findMany).toHaveBeenCalledWith({ where: { id_user: 7, id_condominio: 1 }, select: { id: true } });
    });

    it('sem a carteira revoga direto no banco; com ela, entrega à carteira; nunca lança', async () => {
      const prisma: any = {
        apartamentos_Users: { findFirst: jest.fn(async () => null) },
        moradores: { findMany: jest.fn(async () => [{ id: 11 }]) },
        credenciais_Acesso: { updateMany: jest.fn(async () => ({ count: 2 })) },
      };
      await revogarCredenciaisSemUnidade(prisma, undefined, [7], 1);
      expect(prisma.credenciais_Acesso.updateMany).toHaveBeenCalledWith({
        where: { tipo_pessoa: 'morador', id_pessoa: { in: [11] }, revogada_em: null },
        data: { revogada_em: expect.any(Date) },
      });

      const carteira = { revogarCredenciaisDosMoradores: jest.fn(async () => undefined) };
      prisma.credenciais_Acesso.updateMany.mockClear();
      await revogarCredenciaisSemUnidade(prisma, carteira, [7], 1);
      expect(carteira.revogarCredenciaisDosMoradores).toHaveBeenCalledWith([11]);
      expect(prisma.credenciais_Acesso.updateMany).not.toHaveBeenCalled();

      const log = { warn: jest.fn() };
      prisma.apartamentos_Users.findFirst.mockRejectedValueOnce(new Error('banco fora'));
      await expect(revogarCredenciaisSemUnidade(prisma, carteira, [7], 1, log)).resolves.toBeUndefined();
      expect(log.warn).toHaveBeenCalled();
    });
  });

  describe('unidade apagada (ApartamentosService.remove)', () => {
    function build() {
      const prisma: any = {
        isConnected: true,
        apartamentos: {
          findUnique: jest.fn(async () => ({ id_condominio: 1, apto: '101', bloco: 'Bloco A' })),
          delete: jest.fn(async () => ({ id: 5 })),
        },
        apartamentos_Users: {
          count: jest.fn(async () => 2),
          findMany: jest.fn(async () => [{ id_user: 7 }, { id_user: 8 }]),
          // Depois do delete: a conta 8 segue com outra unidade no condomínio; a 7 não.
          findFirst: jest.fn(async ({ where }: any) => (where.id_user === 8 ? { id_apto: 9 } : null)),
        },
        visitantes: { count: jest.fn(async () => 0) },
        vagas: { count: jest.fn(async () => 0) },
        areas_Sociais_Agendamentos: { count: jest.fn(async () => 0) },
        mudancas: { count: jest.fn(async () => 0) },
        moradores: {
          updateMany: jest.fn(async () => ({ count: 2 })),
          findMany: jest.fn(async ({ where }: any) => (where.id_user === 7 ? [{ id: 11 }] : [{ id: 13 }])),
        },
      };
      const tenant: any = {
        assertEntidade: jest.fn(async () => undefined),
        assertPermissaoFuncionario: jest.fn(async () => undefined),
      };
      const wallet = { revogarCredenciaisDosMoradores: jest.fn(async () => undefined) };
      const svc = new ApartamentosService(prisma, tenant, { registrar: jest.fn() } as any, undefined, wallet as any);
      return { svc, prisma, wallet };
    }

    it('revoga o QR e o passe de quem ficou sem unidade no condomínio, não de quem mora em outra', async () => {
      const { svc, prisma, wallet } = build();

      await svc.remove(5, SINDICO);

      expect(prisma.apartamentos.delete).toHaveBeenCalled();
      expect(wallet.revogarCredenciaisDosMoradores).toHaveBeenCalledTimes(1);
      expect(wallet.revogarCredenciaisDosMoradores).toHaveBeenCalledWith([11]);
    });
  });

  describe('unidade tirada no console (MoradoresService.update com id_apartamento 0)', () => {
    function build(contaSegueComUnidade: boolean) {
      const tx: any = {
        apartamentos_Users: {
          findMany: jest.fn(async () => [{ id: 70, id_apto: 7, apartamento: { bloco: 'A', apto: '101' } }]),
          deleteMany: jest.fn(async () => ({ count: 1 })),
          updateMany: jest.fn(async () => ({ count: 0 })),
        },
        moradores: { update: jest.fn(async () => ({ id: 43, id_user: 41, id_condominio: 1, nome: 'Ana', bloco: null, apartamento: null })) },
        users: { update: jest.fn(async () => ({})) },
      };
      const prisma: any = {
        isConnected: true,
        sindicos_Condominios: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
        funcionarios: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
        $transaction: jest.fn(async (fn: any) => fn(tx)),
        moradores: {
          findUnique: jest.fn(async () => ({
            id: 43, id_user: 41, id_condominio: 1, tipo: 'proprietario', nome: 'Ana', bloco: 'A', apartamento: '101',
          })),
          findMany: jest.fn(async () => [{ id: 43 }]),
          count: jest.fn(async () => 0),
        },
        apartamentos_Users: {
          count: jest.fn(async () => 0),
          findFirst: jest.fn(async () => (contaSegueComUnidade ? { id_apto: 8 } : null)),
        },
        users: { update: jest.fn(async () => ({})) },
      };
      const wallet = { revogarCredenciaisDosMoradores: jest.fn(async () => undefined) };
      const service = new MoradoresService(
        prisma,
        {} as any,
        { isDataUrl: jest.fn().mockReturnValue(false), uploadDataUrl: jest.fn() } as any,
        { syncMorador: jest.fn().mockResolvedValue({}) } as any,
        { registrar: jest.fn().mockResolvedValue({}) } as any,
        { enviarMorador: jest.fn().mockResolvedValue({ enviado: false }) } as any,
        wallet as any,
      );
      jest.spyOn(service as any, 'assertCredencialDisponivel').mockResolvedValue(undefined);
      jest.spyOn(service as any, 'carregarContextoMorador').mockResolvedValue(null);
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 43 } as any);
      return { service, tx, wallet };
    }

    it('sem unidade nenhuma no condomínio: revoga o QR do app e o passe da carteira das linhas dele', async () => {
      const { service, tx, wallet } = build(false);

      await service.update(43, { id_apartamento: 0 } as any);

      expect(tx.apartamentos_Users.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [70] } } });
      expect(wallet.revogarCredenciaisDosMoradores).toHaveBeenCalledWith([43]);
    });

    it('ainda mora em outra unidade do condomínio: o QR continua', async () => {
      const { service, wallet } = build(true);

      await service.update(43, { id_apartamento: 0 } as any);

      expect(wallet.revogarCredenciaisDosMoradores).not.toHaveBeenCalled();
    });

    it('trocar de unidade (id_apartamento > 0) não revoga', async () => {
      const { service, wallet } = build(false);
      (service as any).prisma.$transaction = jest.fn(async () => ({ id: 43, bloco: 'A', apartamento: '102' }));

      await service.update(43, { id_apartamento: 8 } as any);

      expect(wallet.revogarCredenciaisDosMoradores).not.toHaveBeenCalled();
    });
  });

  describe('troca e redefinição de senha (MobileAuthService)', () => {
    it('updatePassword revoga as credenciais da conta pela carteira', async () => {
      const prisma: any = {
        isConnected: true,
        users: {
          findUnique: jest.fn(async () => ({ id: 7, password: 'hash-da-senha-velha' })),
          update: jest.fn(async () => ({
            id: 7, login: 'ana@x.com', photo: null, sindicos: [], moradores: [], funcionarios: [], sindicosCondominios: [],
          })),
        },
      };
      const svc: any = Object.create(MobileAuthService.prototype);
      svc.prisma = prisma;
      svc.jwt = { sign: jest.fn(() => 'token') };
      svc.logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
      svc.wallet = { revogarCredenciaisDaConta: jest.fn(async () => undefined) };
      svc.verifyPassword = jest.fn(async () => true);

      await svc.updatePassword(7, 'senha-nova-123', 'Morador', 'senha-velha');

      expect(prisma.users.update).toHaveBeenCalled();
      expect(svc.wallet.revogarCredenciaisDaConta).toHaveBeenCalledWith(7);
    });

    it('sem a carteira, revoga direto no banco; falha do banco não derruba a troca', async () => {
      const svc: any = Object.create(MobileAuthService.prototype);
      svc.logger = { warn: jest.fn() };
      svc.prisma = {
        moradores: { findMany: jest.fn(async () => [{ id: 11 }, { id: 12 }]) },
        credenciais_Acesso: { updateMany: jest.fn(async () => ({ count: 1 })) },
      };

      await svc.revogarCredenciaisAposTrocaDeSenha(7);
      expect(svc.prisma.credenciais_Acesso.updateMany).toHaveBeenCalledWith({
        where: { tipo_pessoa: 'morador', id_pessoa: { in: [11, 12] }, revogada_em: null },
        data: { revogada_em: expect.any(Date) },
      });

      svc.prisma.moradores.findMany.mockRejectedValueOnce(new Error('banco fora'));
      await expect(svc.revogarCredenciaisAposTrocaDeSenha(7)).resolves.toBeUndefined();
      expect(svc.logger.warn).toHaveBeenCalled();
    });
  });
});
