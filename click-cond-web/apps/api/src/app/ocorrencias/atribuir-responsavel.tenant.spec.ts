import { BadRequestException } from '@nestjs/common';
import { OcorrenciasService } from './ocorrencias.service';

/**
 * `id_responsavel` era um Users.id global, sem conferir o condomínio: a
 * equipe do condomínio 1 atribuía a ocorrência a qualquer usuário do sistema,
 * lia o nome dele de volta em responsavelNome e disparava push para ele.
 * O conjunto atribuível já existe: listFuncionariosAtribuiveis.
 */
describe('OcorrenciasService.atribuir — responsável precisa ser da equipe do condomínio', () => {
  const sindico: any = { sub: 1, typeAccess: 'Sindico', user: { id: 1 } };

  function build() {
    const prisma: any = {
      ocorrencias: {
        findUnique: jest.fn(async () => ({ id_condominio: 1 })),
        update: jest.fn(async ({ data }: any) => ({ id: 7, ...data, categoria: null })),
      },
      // Equipe do condomínio 1: o porteiro com login porteiro@a → Users.id 31.
      funcionarios_Portaria: {
        findMany: jest.fn(async () => [{ id: 3, login: 'porteiro@a', nome: 'Porteiro A', turno: 'Diurno', ativo: 1 }]),
      },
      users: {
        findMany: jest.fn(async () => [{ id: 31, login: 'porteiro@a' }]),
        findUnique: jest.fn(async () => ({ fcm_token: 'tok' })),
      },
    };
    const notifications: any = { sendPushNotification: jest.fn(async () => 'ok') };
    const tenant: any = { assertEntidade: jest.fn(async () => undefined) };
    return { svc: new OcorrenciasService(prisma, notifications, tenant), prisma, notifications };
  }

  it('NEGA atribuir a um usuário que não é da equipe do condomínio', async () => {
    const { svc, prisma, notifications } = build();
    await expect(svc.atribuir(7, 99, sindico)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.ocorrencias.update).not.toHaveBeenCalled();
    expect(notifications.sendPushNotification).not.toHaveBeenCalled();
  });

  it('PERMITE atribuir a funcionário do condomínio e avisa por push', async () => {
    const { svc, prisma, notifications } = build();
    await svc.atribuir(7, 31, sindico);
    expect(prisma.ocorrencias.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { id_responsavel: 31 } }),
    );
    expect(notifications.sendPushNotification).toHaveBeenCalled();
  });

  it('desatribuir (null) não consulta a equipe', async () => {
    const { svc, prisma } = build();
    await svc.atribuir(7, null, sindico);
    expect(prisma.funcionarios_Portaria.findMany).not.toHaveBeenCalled();
    expect(prisma.ocorrencias.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { id_responsavel: null } }),
    );
  });
});
