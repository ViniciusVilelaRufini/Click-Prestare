import { BadRequestException } from '@nestjs/common';
import { MobileAuthService } from './mobile-auth.service';
import { TenantAccessService } from './tenant-access.service';
import type { JwtPayload } from './jwt-payload.interface';

/**
 * Cadastro de porteiro (saveFuncionario, criação): a sincronização com o app (sincronizarUsuarioMobile) acha
 * a conta por `Users.login` e pode recusar por posse. Ela rodava DEPOIS de `funcionarios_Portaria.create`:
 * a linha de portaria ficava gravada e a nova tentativa respondia "Já existe um funcionário com este e-mail".
 * A mesma prova de posse da edição (assertPosseDaContaDoLoginDePortaria) passa a rodar antes do create.
 *
 * Cenário: o login pedido é o e-mail de uma conta daqui (passa em assertLoginLivreParaPortaria, que acha
 * por login OU e-mail) e o login de OUTRA conta, sem vínculo nenhum (a sincronização a acha por login).
 */
type Vinculo = { id_user: number; id_condominio: number };

function prismaFalso(contaPorLogin: any | null) {
  const contaPorEmail = { id: 40, login: 'outro-login@x', email: 'p@x' };
  const moradores: Vinculo[] = [{ id_user: 40, id_condominio: 2 }];
  const sindicos: Vinculo[] = [{ id_user: 20, id_condominio: 2 }];
  const casa = (v: Vinculo, where: any) =>
    v.id_user === where.id_user &&
    (where.id_condominio === undefined ||
      (typeof where.id_condominio === 'object'
        ? v.id_condominio !== where.id_condominio.not
        : v.id_condominio === where.id_condominio));
  const contar = (lista: Vinculo[]) => jest.fn(async ({ where }: any) => lista.filter((v) => casa(v, where)).length);
  return {
    isConnected: true,
    users: {
      findFirst: jest.fn(async ({ where }: any) => {
        if (where?.OR) return contaPorEmail; // assertLoginLivreParaPortaria: login OU e-mail
        if (where?.login === 'p@x') return contaPorLogin; // achada só pelo login
        return null;
      }),
      create: jest.fn(async ({ data }: any) => ({ id: 999, ...data })),
      update: jest.fn(async () => ({})),
    },
    sindicos: { count: jest.fn(async () => 0) },
    sindicos_Condominios: {
      count: contar(sindicos),
      findFirst: jest.fn(async ({ where }: any) => (sindicos.some((v) => casa(v, where)) ? { id: 1 } : null)),
    },
    funcionarios: {
      count: contar([]),
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => ({ id: 500, ...data })),
      update: jest.fn(async () => ({})),
    },
    moradores: { count: contar(moradores) },
    apartamentos_Users: { count: jest.fn(async () => 0) },
    funcionarios_Portaria: {
      findUnique: jest.fn(async () => null),
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => ({ id: 77, ...data })),
    },
    prestadores_servico: { findFirst: jest.fn(async () => null) },
  } as any;
}

function servico(prisma: any) {
  const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
  return new MobileAuthService(prisma, { sign: jest.fn() } as any, {} as any, storage, {} as any, new TenantAccessService(prisma));
}

const sindico: JwtPayload = { sub: 20, nome: 'Síndico', typeAccess: 'Sindico', user: { id: 20 } };
const corpo = { id_condominio: 2, funcionario: { nome: 'Porteiro', email: 'p@x', senha: 'Senha!123' } };

describe('saveFuncionario (criação): posse da conta do login antes de gravar a linha de portaria', () => {
  it('conta achada pelo login sem posse → 400 e funcionarios_Portaria.create não é chamado', async () => {
    const prisma = prismaFalso({ id: 70, login: 'p@x', email: 'dela@x', password: '$2b$04$dela' });
    await expect(servico(prisma).saveFuncionario(corpo, false, sindico)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.funcionarios_Portaria.create).not.toHaveBeenCalled();
    expect(prisma.funcionarios.create).not.toHaveBeenCalled();
    expect(prisma.users.update).not.toHaveBeenCalled();
  });

  it('controle: sem conta com esse login → cria a linha de portaria e a conta do app', async () => {
    const prisma = prismaFalso(null);
    const r = await servico(prisma).saveFuncionario(corpo, false, sindico);
    expect(r).toEqual({ id: 77 });
    expect(prisma.funcionarios_Portaria.create).toHaveBeenCalled();
    expect(prisma.users.create).toHaveBeenCalled();
  });
});
