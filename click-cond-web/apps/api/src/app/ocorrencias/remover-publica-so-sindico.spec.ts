import { ForbiddenException } from '@nestjs/common';
import { OcorrenciasService } from './ocorrencias.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Regra do dono: só o síndico remove ocorrência e alterna Pública/Privada.
 * `remove` e `updatePublica` aceitavam o funcionário do app com a flag
 * `ocorrencias` (assertStaff + flag). Agora é o mesmo critério de
 * `acesso().administrar`: síndico pelo typeAccess (isSindicoEstrito).
 */
describe('Ocorrências — remover e Pública/Privada são só do síndico', () => {
  function montar() {
    const prisma: any = {
      isConnected: true,
      funcionarios: { findFirst: jest.fn(async () => ({ ocorrencias: 1 })) },
      ocorrencias: {
        findUnique: jest.fn(async () => ({ id: 5, id_condominio: 1, user: 100, status: 'Pendente', publica: false })),
        update: jest.fn(async ({ data }: any) => ({ id: 5, ...data })),
        delete: jest.fn(async () => ({})),
      },
    };
    const tenant: any = { assertEntidade: jest.fn(async () => undefined), assertPermissaoFuncionario: jest.fn(async () => undefined) };
    const svc = new OcorrenciasService(prisma, {} as any, tenant, {} as any);
    return { svc, prisma };
  }
  const funcionarioComFlag = { sub: 20, nome: 'Func', typeAccess: 'Funcionario', user: { id: 20 } } as JwtPayload;
  const funcionarioQr = { sub: 20, nome: 'Func', id_condominio: 1, typeAccess: 'Funcionario' } as JwtPayload;
  const sindicoPorTurno = { sub: 3, nome: 'X', id_condominio: 1, turno: 'Síndico', tipo_sub: 'funcionario_portaria' } as JwtPayload;
  const sindico = { sub: 7, nome: 'Síndico', typeAccess: 'Sindico', user: { id: 7 } } as JwtPayload;

  it.each([
    ['funcionário do app com a flag', funcionarioComFlag],
    ['funcionário no console por QR', funcionarioQr],
    ['porteiro com turno "Síndico" (texto livre)', sindicoPorTurno],
  ])('%s → 403 e nada muda', async (_n, user) => {
    const { svc, prisma } = montar();
    await expect(svc.remove(5, user)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.updatePublica(5, true, user)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.ocorrencias.delete).not.toHaveBeenCalled();
    expect(prisma.ocorrencias.update).not.toHaveBeenCalled();
  });

  it('síndico remove e alterna', async () => {
    const { svc, prisma } = montar();
    await svc.updatePublica(5, true, sindico);
    await svc.remove(5, sindico);
    expect(prisma.ocorrencias.update).toHaveBeenCalledTimes(1);
    expect(prisma.ocorrencias.delete).toHaveBeenCalledTimes(1);
  });

  it('o funcionário segue respondendo pelo app (responderPeloApp não muda)', async () => {
    const { svc, prisma } = montar();
    await svc.responderPeloApp(5, { resposta: 'Ok', status: 'ciente' }, funcionarioComFlag);
    expect(prisma.ocorrencias.update).toHaveBeenCalledTimes(1);
  });
});
