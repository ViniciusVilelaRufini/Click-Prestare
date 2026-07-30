import { ForbiddenException } from '@nestjs/common';
import { MobileAuthService } from './mobile-auth.service';
import { TenantAccessService } from './tenant-access.service';
import type { JwtPayload } from './jwt-payload.interface';

/**
 * Antes desta correção, POST /funcionarios/insert não checava quem estava
 * chamando (nem role, nem tenant) — qualquer usuário autenticado no app,
 * inclusive um Morador, conseguia criar um porteiro em QUALQUER condomínio
 * e depois logar como esse porteiro, assumindo controle administrativo
 * daquele condomínio. Estes testes provam que assertSindico + o
 * TenantAccessService (mobile-aware) fecham esse buraco.
 */
describe('MobileAuthService — gestão de funcionários (takeover crítico)', () => {
  const funcionarioCond2 = { id: 50, login: 'porteiro@x.com', id_condominio: 2 };

  function build(overrides: Partial<any> = {}) {
    const prisma: any = {
      isConnected: true,
      funcionarios_Portaria: {
        findUnique: jest.fn(async ({ where }: any) => (where.id === 50 ? { ...funcionarioCond2 } : null)),
        create: jest.fn(async () => ({ id: 999, ...funcionarioCond2 })),
        update: jest.fn(async () => ({ ...funcionarioCond2 })),
        delete: jest.fn(async () => ({})),
      },
      users: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async () => ({ id: 1 })),
        update: jest.fn(async () => ({})),
      },
      funcionarios: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async () => ({})),
        deleteMany: jest.fn(async () => ({ count: 0 })),
        count: jest.fn(async () => 0),
      },
      sindicos_Condominios: { findFirst: jest.fn(async () => null) },
      apartamentos_Users: { findFirst: jest.fn(async () => null) },
      ...overrides,
    };
    // removeFuncionario passou a ser transacional: apagar o vínculo de equipe
    // e a conta tem que ser tudo-ou-nada, senão sobra usuário sem porteiro (ou
    // o contrário). O mock executa o callback com o próprio prisma.
    prisma.$transaction = jest.fn(async (fn: any) =>
      typeof fn === 'function' ? fn(prisma) : Promise.all(fn),
    );
    const jwt: any = { sign: jest.fn(() => 'token') };
    const mail: any = { sendForgotPassword: jest.fn(), sendWelcomeMorador: jest.fn() };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const facial: any = {};
    const tenant = new TenantAccessService(prisma);
    const svc = new MobileAuthService(prisma, jwt, mail, storage, facial, tenant);
    return { svc, prisma };
  }

  const morador: JwtPayload = { sub: 5, nome: 'Morador X', typeAccess: 'Morador' };
  const funcionario: JwtPayload = { sub: 5, nome: 'Porteiro Y', typeAccess: 'Funcionario' };
  const sindicoSemVinculo: JwtPayload = { sub: 9, nome: 'Síndico Z', typeAccess: 'Sindico' };
  const sindicoCond2: JwtPayload = { sub: 9, nome: 'Síndico Z', typeAccess: 'Sindico' };

  describe('saveFuncionario (criação)', () => {
    const body = { id_condominio: 2, funcionario: { nome: 'Novo Porteiro', email: 'novo@x.com' } };

    it('NEGA morador criar funcionário', async () => {
      const { svc, prisma } = build();
      await expect(svc.saveFuncionario(body, false, morador)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.funcionarios_Portaria.create).not.toHaveBeenCalled();
    });

    it('NEGA funcionário criar outro funcionário (só síndico)', async () => {
      const { svc, prisma } = build();
      await expect(svc.saveFuncionario(body, false, funcionario)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.funcionarios_Portaria.create).not.toHaveBeenCalled();
    });

    it('NEGA síndico sem vínculo ao condomínio alvo', async () => {
      const { svc, prisma } = build();
      await expect(svc.saveFuncionario(body, false, sindicoSemVinculo)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.funcionarios_Portaria.create).not.toHaveBeenCalled();
    });

    it('PERMITE síndico vinculado ao condomínio alvo', async () => {
      const { svc, prisma } = build({
        sindicos_Condominios: {
          findFirst: jest.fn(async ({ where }: any) =>
            where.id_user === 9 && where.id_condominio === 2 ? { id: 1 } : null,
          ),
        },
      });
      await svc.saveFuncionario(body, false, sindicoCond2);
      expect(prisma.funcionarios_Portaria.create).toHaveBeenCalled();
    });
  });

  describe('removeFuncionario', () => {
    it('NEGA morador remover funcionário', async () => {
      const { svc, prisma } = build();
      await expect(svc.removeFuncionario(50, morador)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.funcionarios_Portaria.delete).not.toHaveBeenCalled();
    });

    it('NEGA síndico de outro condomínio remover funcionário do condomínio 2', async () => {
      const { svc, prisma } = build();
      await expect(svc.removeFuncionario(50, sindicoSemVinculo)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.funcionarios_Portaria.delete).not.toHaveBeenCalled();
    });

    it('PERMITE síndico vinculado ao condomínio do funcionário', async () => {
      const { svc, prisma } = build({
        sindicos_Condominios: {
          findFirst: jest.fn(async ({ where }: any) =>
            where.id_user === 9 && where.id_condominio === 2 ? { id: 1 } : null,
          ),
        },
      });
      await svc.removeFuncionario(50, sindicoCond2);
      expect(prisma.funcionarios_Portaria.delete).toHaveBeenCalled();
    });
  });
});
