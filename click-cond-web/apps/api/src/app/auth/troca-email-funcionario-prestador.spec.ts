import { createHash } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { MobileAuthService } from './mobile-auth.service';
import type { JwtPayload } from './jwt-payload.interface';

/**
 * O PrestadoresService reconhece o login de portaria "do prestador" pelo texto do e-mail gravado no
 * prestador. Um funcionário que trocasse o próprio e-mail para o de um prestador de um condomínio
 * onde é equipe passaria a ter o login tratado como o desse prestador. A troca é recusada com a
 * mesma mensagem neutra de e-mail em uso; o prestador da própria conta (e-mail = login/e-mail antigo
 * dela) segue sendo levado junto pela troca.
 */
describe('updateInfosFuncionario — e-mail novo igual ao de um prestador', () => {
  const FUNCIONARIO: JwtPayload = { sub: 5, nome: 'Porteiro', typeAccess: 'Funcionario' };
  const MSG = 'Já existe outro usuário com este e-mail.';

  /** Prestadores do condomínio 2, onde a conta 5 é equipe. */
  function build(prestadoresDoCondominio: Array<{ id: number; email: string }>) {
    const ehEquipe = (where: any) => where?.condominio?.funcionarios?.some?.id_user === 5;
    const prisma: any = {
      isConnected: true,
      users: {
        findFirst: jest.fn(async () => null),
        findUnique: jest.fn(async () => ({
          id: 5,
          photo: '',
          email: 'antigo@x.com',
          login: 'antigo@x.com',
          password: createHash('md5').update('segredo').digest('hex'),
          funcionarios: [{ nome: 'Porteiro' }],
        })),
        update: jest.fn(async () => ({})),
      },
      funcionarios: {
        findFirst: jest.fn(async ({ where }: any) =>
          where.id_user === 5 ? { id: 30, id_user: 5, nome: 'Porteiro', email: 'antigo@x.com' } : null,
        ),
        update: jest.fn(async () => ({})),
      },
      funcionarios_Portaria: {
        findFirst: jest.fn(async () => null),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
      prestadores_servico: {
        findFirst: jest.fn(async ({ where }: any) => {
          if (!ehEquipe(where)) return null;
          return prestadoresDoCondominio.find((p) => p.email === where.email) ?? null;
        }),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    const jwt: any = { sign: jest.fn(() => 'token-novo') };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const svc = new MobileAuthService(
      prisma,
      jwt,
      {} as any,
      storage,
      {} as any,
      {} as any,
      undefined as any,
      undefined as any,
      undefined as any,
      undefined as any,
    );
    return { svc, prisma };
  }

  it('recusa e-mail novo igual ao de um prestador de condomínio onde a conta é equipe', async () => {
    const { svc, prisma } = build([{ id: 50, email: 'prestador@x.com' }]);

    const r = svc.updateInfosFuncionario(
      { funcionario: { email: 'prestador@x.com', senha_atual: 'segredo' } },
      FUNCIONARIO,
    );
    await expect(r).rejects.toBeInstanceOf(BadRequestException);
    await expect(r).rejects.toThrow(MSG);

    // Nada da troca é gravado (o users.update da senha MD5 → bcrypt, na conferência da senha, não conta).
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.users.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: 'prestador@x.com' }) }),
    );
  });

  it('a troca do funcionário que é o próprio prestador continua passando e leva o prestador junto', async () => {
    const { svc, prisma } = build([{ id: 51, email: 'antigo@x.com' }]);

    const res: any = await svc.updateInfosFuncionario(
      { funcionario: { email: 'novo@x.com', senha_atual: 'segredo' } },
      FUNCIONARIO,
    );

    expect(res.token).toBe('token-novo');
    expect(prisma.users.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: 'novo@x.com', login: 'novo@x.com' }) }),
    );
    expect(prisma.prestadores_servico.updateMany).toHaveBeenCalledWith({
      where: { email: { in: ['antigo@x.com'] }, condominio: { funcionarios: { some: { id_user: 5 } } } },
      data: { email: 'novo@x.com' },
    });
  });
});
