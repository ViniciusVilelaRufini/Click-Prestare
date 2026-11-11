import { ForbiddenException } from '@nestjs/common';
import { MobileAuthService } from './mobile-auth.service';
import { TenantAccessService } from './tenant-access.service';

/**
 * As flags da tabela `Funcionarios` (`ocorrencias`, `apartamentos`…) são o
 * que o síndico usa para limitar o que cada pessoa da equipe faz no app. O
 * `getOcorrenciaById` e o `ApartamentosService` do console já as cobravam,
 * mas as rotas do app que fazem a mesma coisa não:
 *  - as listas de ocorrência (todas / pendentes) entregavam as privadas a
 *    funcionário com `ocorrencias = 0` — a mesma ocorrência que ele tomava
 *    403 ao abrir;
 *  - cadastrar/editar apartamento e cadastrar/editar/remover morador pelo app
 *    passavam por cima de `apartamentos = 0`.
 *
 * A flag é lida do banco pelo TenantAccessService real; síndico nunca é
 * barrado por flag.
 */
describe('App — flags do funcionário', () => {
  const ID_COND = 3;

  function montar(flags: Record<string, number>, prismaExtra: any = {}) {
    const prisma: any = {
      isConnected: true,
      funcionarios: { findFirst: jest.fn(async () => ({ ...flags })) },
      ocorrencias: { findMany: jest.fn(async () => []) },
      users: { findMany: jest.fn(async () => []) },
      ...prismaExtra,
    };
    prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
    const real = new TenantAccessService(prisma);
    const tenant: any = {
      assertCondominio: jest.fn(async () => undefined),
      assertEntidade: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn((id: number, flag: any, p: any) => real.assertPermissaoFuncionario(id, flag, p)),
    };
    const facial: any = { unsyncMorador: jest.fn(async () => true) };
    const svc = new MobileAuthService(
      prisma, {} as any, {} as any, {} as any, facial, tenant, {} as any, {} as any, {} as any, {} as any,
    );
    return { svc, prisma, tenant };
  }

  const funcionario: any = { sub: 20, nome: 'Bruno', typeAccess: 'Funcionario', user: { id: 20 } };
  const sindico: any = { sub: 9, nome: 'Síndico', typeAccess: 'Sindico', user: { id: 9 } };

  describe('listas de ocorrência', () => {
    const filtroDoMorador = (idUser: number) => [{ user: idUser }, { publica: true }];

    for (const [nome, chamar] of [
      ['todos', (svc: MobileAuthService, u: any) => svc.listOcorrenciasTodos(ID_COND, u.sub, u.typeAccess, u)],
      ['pendentes', (svc: MobileAuthService, u: any) => svc.listOcorrenciasPendentes(ID_COND, u.sub, u.typeAccess, u)],
    ] as const) {
      it(`${nome}: funcionário sem a flag ocorrencias recebe só as próprias e as públicas`, async () => {
        const { svc, prisma } = montar({ ocorrencias: 0 });
        await chamar(svc, funcionario);
        const where = prisma.ocorrencias.findMany.mock.calls[0][0].where;
        expect(where.OR).toEqual(filtroDoMorador(20));
        expect(where.id_condominio).toBe(ID_COND);
      });

      it(`${nome}: funcionário com a flag vê todas do condomínio`, async () => {
        const { svc, prisma } = montar({ ocorrencias: 1 });
        await chamar(svc, funcionario);
        expect(prisma.ocorrencias.findMany.mock.calls[0][0].where.OR).toBeUndefined();
      });

      it(`${nome}: síndico vê todas, sem consultar flag`, async () => {
        const { svc, prisma } = montar({ ocorrencias: 0 });
        await chamar(svc, sindico);
        expect(prisma.ocorrencias.findMany.mock.calls[0][0].where.OR).toBeUndefined();
        expect(prisma.funcionarios.findFirst).not.toHaveBeenCalled();
      });
    }
  });

  describe('apartamentos (saveApto)', () => {
    const corpo = (extra: any = {}) => ({ id_condominio: ID_COND, Apartamento: { apto: '101', bloco: 'A', ...extra } });

    it('NEGA criar apartamento a funcionário sem a flag apartamentos', async () => {
      const { svc, prisma } = montar({ apartamentos: 0 }, { apartamentos: { create: jest.fn(async () => ({ id: 1 })) } });
      await expect(svc.saveApto(corpo(), false, funcionario)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.apartamentos.create).not.toHaveBeenCalled();
    });

    it('NEGA editar apartamento a funcionário sem a flag apartamentos', async () => {
      const { svc, prisma } = montar({ apartamentos: 0 }, {
        apartamentos: {
          findUnique: jest.fn(async () => ({ id_condominio: ID_COND })),
          update: jest.fn(async () => ({ id: 5 })),
        },
      });
      await expect(svc.saveApto(corpo({ id: 5 }), true, funcionario)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.apartamentos.update).not.toHaveBeenCalled();
    });

    it('PERMITE funcionário com a flag e o síndico', async () => {
      const a = montar({ apartamentos: 1 }, { apartamentos: { create: jest.fn(async () => ({ id: 1 })) } });
      await expect(a.svc.saveApto(corpo(), false, funcionario)).resolves.toEqual({ id: 1 });
      const b = montar({ apartamentos: 0 }, { apartamentos: { create: jest.fn(async () => ({ id: 2 })) } });
      await expect(b.svc.saveApto(corpo(), false, sindico)).resolves.toEqual({ id: 2 });
    });
  });

  describe('moradores (saveMorador / removeMorador)', () => {
    const moradorAlheio = { id: 11, id_user: 12, id_condominio: ID_COND, face_id: null, nome: 'Vizinho', user: { id: 12 } };

    it('NEGA cadastrar morador a funcionário sem a flag apartamentos', async () => {
      const { svc, prisma } = montar({ apartamentos: 0 }, {
        apartamentos: { findUnique: jest.fn(async () => ({ id: 7, id_condominio: ID_COND, bloco: 'A', apto: '101' })) },
        moradores: { findFirst: jest.fn(async () => null), create: jest.fn() },
      });
      await expect(
        svc.saveMorador({ id_condominio: ID_COND, morador: { id_apto: 7, nome: 'Novo' } }, false, funcionario),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.moradores.findFirst).not.toHaveBeenCalled();
    });

    it('NEGA editar morador alheio a funcionário sem a flag apartamentos', async () => {
      const { svc, prisma } = montar({ apartamentos: 0 }, {
        moradores: { findUnique: jest.fn(async () => ({ ...moradorAlheio })), update: jest.fn() },
      });
      await expect(
        svc.saveMorador({ morador: { id: 11, nome: 'Trocado' } }, true, funcionario),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.moradores.update).not.toHaveBeenCalled();
    });

    it('NEGA remover morador a funcionário sem a flag apartamentos', async () => {
      const { svc, prisma } = montar({ apartamentos: 0 }, {
        moradores: { findUnique: jest.fn(async () => ({ ...moradorAlheio })), delete: jest.fn() },
        apartamentos: { findMany: jest.fn(async () => []) },
        apartamentos_Users: { deleteMany: jest.fn() },
      });
      await expect(svc.removeMorador(11, funcionario)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.moradores.delete).not.toHaveBeenCalled();
    });

    it('PERMITE remover com a flag e ao síndico', async () => {
      const extra = () => ({
        moradores: { findUnique: jest.fn(async () => ({ ...moradorAlheio })), delete: jest.fn(async () => ({})) },
        apartamentos: { findMany: jest.fn(async () => []) },
        apartamentos_Users: { deleteMany: jest.fn() },
      });
      await expect(montar({ apartamentos: 1 }, extra()).svc.removeMorador(11, funcionario)).resolves.toBe(true);
      await expect(montar({ apartamentos: 0 }, extra()).svc.removeMorador(11, sindico)).resolves.toBe(true);
    });
  });
});
