import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { MobileAuthService } from './mobile-auth.service';
import { TenantAccessService } from './tenant-access.service';

/**
 * Condomínio desativado no CRM precisa derrubar o app junto: a web já corta
 * (`condominio: { ativo: 1 }`), mas assertCondominio e os logins do app não olhavam.
 */
const SUSPENSO = 'O acesso deste condomínio está suspenso. Fale com a administração.';

/** Simula o banco: o vínculo só "existe" se o filtro de condomínio ativo bater com o estado do condomínio. */
function vinculoQueRespeitaAtivo(condominioAtivo: boolean) {
  return jest.fn(async ({ where }: any) => {
    const exigeAtivo = where?.condominio?.ativo === 1 || where?.apartamento?.condominio?.ativo === 1;
    if (exigeAtivo && !condominioAtivo) return null;
    return { id: 1, id_apto: 1 };
  });
}

describe('assertCondominio — condomínio inativo', () => {
  function build(ativo: boolean) {
    const prisma: any = {
      isConnected: true,
      sindicos_Condominios: { findFirst: vinculoQueRespeitaAtivo(ativo) },
      funcionarios: { findFirst: vinculoQueRespeitaAtivo(ativo) },
      apartamentos_Users: { findFirst: vinculoQueRespeitaAtivo(ativo) },
    };
    return new TenantAccessService(prisma);
  }

  const sindico: any = { sub: 9, nome: 'S', typeAccess: 'Sindico' };
  const funcionario: any = { sub: 9, nome: 'F', typeAccess: 'Funcionario' };
  const morador: any = { sub: 9, nome: 'M', typeAccess: 'Morador' };

  it.each([
    ['síndico', sindico],
    ['funcionário', funcionario],
    ['morador', morador],
  ])('%s: vínculo em condomínio inativo → 403', async (_n, payload) => {
    await expect(build(false).assertCondominio(5, payload)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([
    ['síndico', sindico],
    ['funcionário', funcionario],
    ['morador', morador],
  ])('%s: condomínio ativo segue passando', async (_n, payload) => {
    await expect(build(true).assertCondominio(5, payload)).resolves.toBeUndefined();
  });

  it('rota do app que usa assertCondominio (getInfosCondominio) devolve 403 no condomínio inativo', async () => {
    const tenant = build(false);
    const prisma: any = { isConnected: true, condominios: { findUnique: jest.fn() } };
    const service = new MobileAuthService(prisma, {} as any, {} as any, {} as any, {} as any, tenant as any);
    await expect(service.getInfosCondominio(5, sindico)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.condominios.findUnique).not.toHaveBeenCalled();
  });
});

describe('logins do app — condomínio inativo', () => {
  let hash: string;
  beforeAll(async () => {
    hash = await bcrypt.hash('senha', 4);
  });

  const svcCom = (prisma: any) =>
    new MobileAuthService(prisma, { sign: jest.fn(() => 'tok') } as any, {} as any, {} as any, {} as any, {} as any);
  const inativo = { condominio: { ativo: 0 } };
  const ativo = { condominio: { ativo: 1 } };

  it('loginSindico: só vínculos inativos → recusa com a mensagem de suspensão', async () => {
    const prisma: any = {
      isConnected: true,
      users: {
        findFirst: jest.fn(async () => ({
          id: 1, login: 'a', password: hash, sindicos: [{ name: 'S' }], sindicosCondominios: [inativo],
        })),
      },
    };
    const err = await svcCom(prisma).loginSindico('a', 'senha').catch((e) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect(err.message).toBe(SUSPENSO);
  });

  it('loginSindico: um ativo e um inativo → entra', async () => {
    const prisma: any = {
      isConnected: true,
      users: {
        findFirst: jest.fn(async () => ({
          id: 1, login: 'a', password: hash, sindicos: [{ name: 'S' }], sindicosCondominios: [inativo, ativo],
        })),
      },
    };
    await expect(svcCom(prisma).loginSindico('a', 'senha')).resolves.toMatchObject({ token: 'tok' });
  });

  it('loginMorador: só vínculos inativos → recusa', async () => {
    const prisma: any = {
      isConnected: true,
      users: {
        findFirst: jest.fn(async () => ({
          id: 1, login: 'a', password: hash,
          moradores: [{ nome: 'M', condominio: { ativo: 0 } }],
          apartamentosUsers: [{ apartamento: inativo }],
        })),
      },
    };
    const err = await svcCom(prisma).loginMorador('a', 'senha').catch((e) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect(err.message).toBe(SUSPENSO);
  });

  it('loginMorador: um ativo e um inativo → entra', async () => {
    const prisma: any = {
      isConnected: true,
      users: {
        findFirst: jest.fn(async () => ({
          id: 1, login: 'a', password: hash,
          moradores: [{ nome: 'M', condominio: { ativo: 0 } }],
          apartamentosUsers: [{ apartamento: inativo }, { apartamento: ativo }],
        })),
      },
    };
    await expect(svcCom(prisma).loginMorador('a', 'senha')).resolves.toMatchObject({ token: 'tok' });
  });

  it('loginFuncionario: só vínculos inativos → recusa', async () => {
    const prisma: any = {
      isConnected: true,
      users: {
        findFirst: jest.fn(async () => ({
          id: 1, login: 'a', password: hash, funcionarios: [{ id_condominio: 1, nome: 'F', condominio: { ativo: 0 } }],
        })),
      },
    };
    const err = await svcCom(prisma).loginFuncionario('a', 'senha').catch((e) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect(err.message).toBe(SUSPENSO);
  });

  it('loginFuncionario: um ativo e um inativo → entra', async () => {
    const prisma: any = {
      isConnected: true,
      users: {
        findFirst: jest.fn(async () => ({
          id: 1, login: 'a', password: hash,
          funcionarios: [
            { id_condominio: 1, nome: 'F', condominio: { ativo: 0 } },
            { id_condominio: 2, nome: 'F', condominio: { ativo: 1 } },
          ],
        })),
      },
    };
    await expect(svcCom(prisma).loginFuncionario('a', 'senha')).resolves.toMatchObject({ token: 'tok' });
  });
});
