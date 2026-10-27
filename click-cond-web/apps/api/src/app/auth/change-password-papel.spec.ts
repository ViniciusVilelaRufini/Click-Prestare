import { ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import type { JwtPayload } from './jwt-payload.interface';

/**
 * /auth/change-password tratava todo token que não fosse 'Sindico' como de porteiro do console
 * (sub = Funcionarios_Portaria.id). O token de console emitido pelo QR do app para a equipe tem
 * typeAccess 'Funcionario' e sub = Users.id — outra numeração: o Users.id podia bater com o id de
 * OUTRO porteiro, e a troca mexia na senha dele. Só o token marcado com tipo_sub troca a senha do
 * porteiro; quem entrou pelo app troca a senha pelo próprio app.
 */
describe('AuthService.changePassword — qual conta o token representa', () => {
  let hash: string;
  beforeAll(async () => {
    hash = await bcrypt.hash('atual', 4);
  });

  function build() {
    const prisma: any = {
      isConnected: true,
      users: { findUnique: jest.fn(async () => ({ id: 6, password: hash })), update: jest.fn(async () => ({})) },
      funcionarios_Portaria: {
        findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, password: hash })),
        update: jest.fn(async () => ({})),
      },
    };
    const svc = new AuthService(prisma, { sign: jest.fn(() => 't') } as any, {} as any);
    return { svc, prisma };
  }

  it('porteiro do console (tipo_sub funcionario_portaria) troca a senha em Funcionarios_Portaria', async () => {
    const { svc, prisma } = build();
    const sessao: JwtPayload = { sub: 6, nome: 'P', id_condominio: 1, tipo_sub: 'funcionario_portaria' };

    await expect(svc.changePassword(6, 'atual', 'nova-senha', undefined, sessao)).resolves.toMatchObject({ success: true });
    expect(prisma.funcionarios_Portaria.update).toHaveBeenCalledWith({
      where: { id: 6 },
      data: { password: expect.stringMatching(/^\$2/) },
    });
  });

  it.each([['Funcionario'], ['Morador']])(
    'token %s (sub = Users.id) NÃO mexe em Funcionarios_Portaria nem em Users',
    async (papel) => {
      const { svc, prisma } = build();
      const sessao: JwtPayload = { sub: 6, nome: 'B', id_condominio: 1, typeAccess: papel };

      await expect(svc.changePassword(6, 'atual', 'nova-senha', papel, sessao)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.funcionarios_Portaria.findUnique).not.toHaveBeenCalled();
      expect(prisma.funcionarios_Portaria.update).not.toHaveBeenCalled();
      expect(prisma.users.update).not.toHaveBeenCalled();
    },
  );

  it('token sem tipo_sub nem typeAccess (formato antigo) NÃO é tratado como porteiro', async () => {
    const { svc, prisma } = build();
    const sessao: JwtPayload = { sub: 6, nome: 'P', id_condominio: 1 };

    await expect(svc.changePassword(6, 'atual', 'nova-senha', undefined, sessao)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.funcionarios_Portaria.update).not.toHaveBeenCalled();
  });
});
