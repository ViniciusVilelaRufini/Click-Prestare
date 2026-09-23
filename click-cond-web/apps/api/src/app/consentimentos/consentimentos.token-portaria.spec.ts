import { ForbiddenException } from '@nestjs/common';
import { ConsentimentosService } from './consentimentos.service';

/**
 * As rotas "do próprio usuário" (/consentimentos, /pendentes,
 * /revogar-biometria) tomavam `payload.sub` como Users.id. No token da
 * portaria-web o `sub` é Funcionarios_Portaria.id: o porteiro revogava a
 * biometria — e tirava o rosto do terminal — do morador de mesmo número, ou
 * registrava aceite em nome dele.
 */
describe('Consentimentos — token da portaria não é um usuário', () => {
  const porteiro = { sub: 50, nome: 'QA_SECURITY_20260923 porteiro', id_condominio: 1 } as any;

  function montar() {
    const prisma: any = {
      consentimentos: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async () => ({})),
        findMany: jest.fn(async () => []),
      },
      moradores: { findMany: jest.fn(async () => []), updateMany: jest.fn(async () => ({ count: 0 })) },
    };
    const facial: any = { revogarBiometriaUsuario: jest.fn(async () => ({})), unsyncMorador: jest.fn(async () => ({})) };
    return { svc: new ConsentimentosService(prisma, facial), prisma };
  }

  it('revogar-biometria com token da portaria é recusado', async () => {
    const { svc, prisma } = montar();
    await expect(svc.revogarBiometria(porteiro)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.consentimentos.create).not.toHaveBeenCalled();
  });

  it('pendentes com token da portaria é recusado', async () => {
    const { svc } = montar();
    await expect(svc.pendentes(porteiro)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
