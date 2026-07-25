import { ForbiddenException } from '@nestjs/common';
import { MobileAuthService } from './mobile-auth.service';
import { TenantAccessService } from './tenant-access.service';
import type { JwtPayload } from './jwt-payload.interface';

/**
 * Rotas que existiam só no backend Express e o app continuava chamando em
 * produção (404 silencioso). Ao portar para o NestJS, a autorização precisou
 * ser reescrita: o Express confiava em `req.session.user` + typeAccess, aqui
 * o alvo sai do JWT e o vínculo é conferido no banco.
 *
 * Estes testes travam justamente o que o port poderia afrouxar.
 */
describe('MobileAuthService — rotas portadas do Express', () => {
  function build(overrides: Partial<any> = {}) {
    const prisma: any = {
      isConnected: true,
      users: {
        findFirst: jest.fn(async () => null),
        findUnique: jest.fn(async () => null),
        create: jest.fn(async () => ({ id: 1 })),
        update: jest.fn(async () => ({})),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
      moradores: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async () => ({ id: 77 })),
      },
      funcionarios: { findFirst: jest.fn(async () => null), update: jest.fn(async () => ({})) },
      funcionarios_Portaria: { findUnique: jest.fn(async () => null) },
      apartamentos: { findUnique: jest.fn(async () => ({ id: 10, id_condominio: 2, bloco: 'A', apto: '101' })) },
      apartamentos_Users: {
        findFirst: jest.fn(async () => null),
        findMany: jest.fn(async () => []),
        create: jest.fn(async () => ({})),
      },
      sindicos_Condominios: { findFirst: jest.fn(async () => null) },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
      ...overrides,
    };
    const jwt: any = { sign: jest.fn(() => 'token-novo') };
    const mail: any = { sendWelcomeMorador: jest.fn(), sendWelcomeMoradorExisting: jest.fn() };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const facial: any = {};
    const tenant = new TenantAccessService(prisma);
    const svc = new MobileAuthService(prisma, jwt, mail, storage, facial, tenant);
    return { svc, prisma };
  }

  const proprietario: JwtPayload = { sub: 5, nome: 'Dono', typeAccess: 'Morador' };
  const inquilino: JwtPayload = { sub: 6, nome: 'Inquilino', typeAccess: 'Morador' };

  // -------------------------------------------------------------------------
  describe('insertFamiliar', () => {
    const body = { id_condominio: 2, morador: { nome: 'Filho', id_apto: 10 } };

    /**
     * Vínculo do usuário com o apto 10 (condomínio 2).
     *
     * O findFirst é consultado com dois formatos diferentes de `where`:
     *  - { id_apto, id_user }                      → checagem de proprietário
     *  - { id_user, apartamento: { id_condominio } } → checagem de tenant
     * O mock precisa responder aos dois, senão o teste falha na etapa errada.
     */
    function comVinculo(idUser: number, tipo: string) {
      return {
        apartamentos_Users: {
          findFirst: jest.fn(async ({ where }: any) => {
            if (where.id_user !== idUser) return null;
            if (where.apartamento) {
              return where.apartamento.id_condominio === 2 ? { id_apto: 10 } : null;
            }
            return where.id_apto === 10 ? { tipo } : null;
          }),
          findMany: jest.fn(async () => [{ id_apto: 10 }]),
          create: jest.fn(async () => ({})),
        },
      };
    }

    it('NEGA quem não tem vínculo nenhum com o apartamento', async () => {
      const { svc, prisma } = build();
      await expect(svc.insertFamiliar(body, proprietario)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.moradores.create).not.toHaveBeenCalled();
    });

    it('NEGA inquilino cadastrar familiar (só o proprietário pode)', async () => {
      const { svc, prisma } = build(comVinculo(6, 'inquilino'));
      await expect(svc.insertFamiliar(body, inquilino)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.moradores.create).not.toHaveBeenCalled();
    });

    it('NEGA membro cadastrar outro familiar', async () => {
      const { svc, prisma } = build(comVinculo(6, 'membro'));
      await expect(svc.insertFamiliar(body, inquilino)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.moradores.create).not.toHaveBeenCalled();
    });

    it('PERMITE o proprietário do apartamento', async () => {
      const { svc, prisma } = build(comVinculo(5, 'proprietario'));
      await svc.insertFamiliar(body, proprietario);
      expect(prisma.moradores.create).toHaveBeenCalled();
    });

    it('força tipo "membro" mesmo se o corpo pedir proprietario', async () => {
      const { svc, prisma } = build(comVinculo(5, 'proprietario'));
      await svc.insertFamiliar(
        { ...body, morador: { ...body.morador, tipo: 'proprietario' } },
        proprietario,
      );
      expect(prisma.moradores.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ tipo: 'membro' }) }),
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('updateInfosFuncionario', () => {
    const funcionario: JwtPayload = { sub: 5, nome: 'Porteiro', typeAccess: 'Funcionario' };

    function comFuncionario() {
      return {
        funcionarios: {
          findFirst: jest.fn(async ({ where }: any) =>
            where.id_user === 5 ? { id: 30, id_user: 5, nome: 'Porteiro' } : null,
          ),
          update: jest.fn(async () => ({})),
        },
        users: {
          findFirst: jest.fn(async () => null),
          findUnique: jest.fn(async () => ({ id: 5, photo: '', funcionarios: [{ nome: 'Porteiro' }] })),
          update: jest.fn(async () => ({})),
          updateMany: jest.fn(async () => ({ count: 0 })),
        },
      };
    }

    it('edita o funcionário do JWT, ignorando o id vindo do corpo', async () => {
      const { svc, prisma } = build(comFuncionario());
      // O corpo tenta apontar para outro funcionário (id 999).
      await svc.updateInfosFuncionario(
        { funcionario: { id: 999, nome: 'Novo Nome' } },
        funcionario,
      );
      // Resolveu pelo id_user do token, não pelo id do corpo.
      expect(prisma.funcionarios.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id_user: 5 } }),
      );
      expect(prisma.funcionarios.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 30 } }),
      );
    });

    it('devolve token e user novos (o login muda junto com o e-mail)', async () => {
      const { svc } = build(comFuncionario());
      const res: any = await svc.updateInfosFuncionario(
        { funcionario: { nome: 'Porteiro', email: 'novo@x.com' } },
        funcionario,
      );
      expect(res.token).toBe('token-novo');
      expect(res.user).toEqual(expect.objectContaining({ id: 5 }));
    });
  });

  // -------------------------------------------------------------------------
  describe('updateFcmToken', () => {
    it('solta o token de outro usuário antes de gravar (aparelho compartilhado)', async () => {
      const { svc, prisma } = build();
      await svc.updateFcmToken(5, 'fcm-abc');
      expect(prisma.users.updateMany).toHaveBeenCalledWith({
        where: { fcm_token: 'fcm-abc', id: { not: 5 } },
        data: { fcm_token: null },
      });
      expect(prisma.users.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: { fcm_token: 'fcm-abc' },
      });
    });

    it('recusa token vazio', async () => {
      const { svc, prisma } = build();
      await expect(svc.updateFcmToken(5, '   ')).rejects.toThrow();
      expect(prisma.users.update).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe('getNotificationSettings', () => {
    it('devolve 1/0 e não booleano (a tela do app compara == 1)', async () => {
      const { svc } = build({
        users: {
          findUnique: jest.fn(async () => ({
            notif_encomendas: 1,
            notif_comunicados: 0,
            notif_ocorrencias: 1,
            notif_visitantes: 0,
          })),
        },
      });
      const res = await svc.getNotificationSettings(5);
      expect(res).toEqual({
        notif_encomendas: 1,
        notif_comunicados: 0,
        notif_ocorrencias: 1,
        notif_visitantes: 0,
      });
    });
  });
});
