import { ForbiddenException } from '@nestjs/common';
import { MobileAuthService } from './mobile-auth.service';

/**
 * `GET /funcionarios/get-all` só conferia o vínculo com o condomínio: o
 * morador recebia a lista da equipe com e-mail e telefone de cada porteiro.
 * No app, a lista é usada só por telas da equipe (cadastro de funcionário,
 * atribuir ocorrência). Regra: exige operador (síndico, funcionário ou
 * console), como as demais listas administrativas.
 */
describe('MobileAuthService.getAllFuncionarios — só operador', () => {
  function build() {
    const prisma: any = {
      isConnected: true,
      funcionarios_Portaria: {
        findMany: jest.fn(async () => [
          { id: 1, nome: 'Porteiro', login: 'p@demo.com', email: 'p@demo.com', telefone: '17999990000', turno: 'Dia' },
        ]),
      },
      users: { findMany: jest.fn(async () => []) },
    };
    const tenant: any = { assertCondominio: jest.fn(async () => undefined) };
    const svc = new MobileAuthService(prisma, {} as any, {} as any, {} as any, {} as any, tenant);
    return { svc, prisma };
  }

  it('NEGA ao morador', async () => {
    const { svc, prisma } = build();
    const morador: any = { sub: 50, typeAccess: 'Morador', user: { id: 50 } };
    await expect(svc.getAllFuncionarios(1, morador)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.funcionarios_Portaria.findMany).not.toHaveBeenCalled();
  });

  it('PERMITE síndico, funcionário e o console', async () => {
    const { svc } = build();
    for (const u of [
      { sub: 9, typeAccess: 'Sindico' },
      { sub: 20, typeAccess: 'Funcionario' },
      { sub: 3, nome: 'Porteiro', id_condominio: 1 },
    ] as any[]) {
      const lista = await svc.getAllFuncionarios(1, u);
      expect(lista[0]).toMatchObject({ email: 'p@demo.com', telefone: '17999990000' });
    }
  });
});
