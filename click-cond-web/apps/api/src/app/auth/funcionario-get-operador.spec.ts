import { ForbiddenException } from '@nestjs/common';
import { MobileAuthService } from './mobile-auth.service';

/**
 * A lista da equipe (get-all) já exigia operador; o by-id não. Com ids sequenciais, o morador
 * remontava a lista e levava e-mail (ou o login do console), telefone e foto de cada porteiro.
 */
describe('MobileAuthService.getFuncionarioById — só operador', () => {
  function build() {
    const prisma: any = {
      isConnected: true,
      funcionarios_Portaria: {
        findUnique: jest.fn(async () => ({ id: 1, id_condominio: 1, nome: 'Porteiro', login: 'p@demo', email: null, telefone: '17999990000', turno: 'Dia' })),
      },
      users: { findFirst: jest.fn(async () => null) },
      funcionarios: {
        findFirst: jest.fn(async () => ({ id: 3, id_user: 20, nome: 'Eu', email: 'eu@demo', documento: null, telefone: null, funcao: null, ch: null, user: { photo: null, email: 'eu@demo' } })),
      },
    };
    const tenant: any = { assertEntidade: jest.fn(async () => undefined) };
    const svc = new MobileAuthService(prisma, {} as any, {} as any, {} as any, {} as any, tenant);
    return { svc, prisma };
  }

  it('NEGA ao morador e não consulta o cadastro', async () => {
    const { svc, prisma } = build();
    await expect(svc.getFuncionarioById(1, { sub: 50, typeAccess: 'Morador', user: { id: 50 } } as any))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.funcionarios_Portaria.findUnique).not.toHaveBeenCalled();
  });

  it('PERMITE síndico e o console', async () => {
    const { svc } = build();
    for (const u of [{ sub: 9, typeAccess: 'Sindico' }, { sub: 3, nome: 'P', id_condominio: 1 }] as any[]) {
      await expect(svc.getFuncionarioById(1, u)).resolves.toMatchObject({ email: 'p@demo', telefone: '17999990000' });
    }
  });

  it('funcionário do app continua lendo o PRÓPRIO cadastro (id 0)', async () => {
    const { svc, prisma } = build();
    await expect(svc.getFuncionarioById(0, { sub: 20, typeAccess: 'Funcionario', user: { id: 20 } } as any))
      .resolves.toMatchObject({ id: 20, email: 'eu@demo' });
    expect(prisma.funcionarios_Portaria.findUnique).not.toHaveBeenCalled();
  });
});
