import { BadRequestException } from '@nestjs/common';
import { ComunicadosService } from './comunicados.service';

/** Salvar vazio criava comunicado sem título e empurrava push em branco. */
describe('ComunicadosService — título e descrição obrigatórios', () => {
  const sindico: any = { sub: 1, typeAccess: 'Sindico', user: { id: 1 } };

  function build() {
    const prisma: any = {
      isConnected: true,
      comunicados: {
        create: jest.fn(async (a: any) => ({ id: 11, id_condominio: 1, ...a.data })),
        update: jest.fn(async (a: any) => ({ id: 11, id_condominio: 1, ...a.data })),
        findUnique: jest.fn(async () => ({ id: 11, id_condominio: 1, titulo: 'a', descricao: 'b' })),
      },
      users: { findMany: jest.fn(async () => [{ fcm_token: 'a' }]) },
    };
    const tenant: any = {
      assertCondominio: jest.fn(async () => undefined),
      assertEntidade: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async () => undefined),
    };
    const notifications: any = { sendPushNotification: jest.fn(async () => 'ok') };
    const service = new ComunicadosService(prisma, { registrar: jest.fn() } as any, tenant, notifications);
    return { service, prisma, notifications };
  }

  it.each([
    [{ titulo: '', descricao: 'x' }, 'Informe o título do comunicado.'],
    [{ titulo: '   ', descricao: 'x' }, 'Informe o título do comunicado.'],
    [{ titulo: 'Obra', descricao: '' }, 'Informe a descrição do comunicado.'],
    [{ titulo: 'Obra', descricao: '  ' }, 'Informe a descrição do comunicado.'],
    [{ titulo: 'Obra' }, 'Informe a descrição do comunicado.'],
  ])('create %j → 400 sem gravar nem notificar', async (dto, msg) => {
    const { service, prisma, notifications } = build();
    await expect(service.create({ ...dto, id_condominio: 1 } as any, sindico)).rejects.toThrow(
      new BadRequestException(msg),
    );
    await new Promise((r) => setImmediate(r));
    expect(prisma.comunicados.create).not.toHaveBeenCalled();
    expect(notifications.sendPushNotification).not.toHaveBeenCalled();
  });

  it('create grava trimado', async () => {
    const { service, prisma } = build();
    await service.create({ titulo: ' Obra ', descricao: ' Amanhã ', id_condominio: 1 } as any, sindico);
    expect(prisma.comunicados.create.mock.calls[0][0].data).toMatchObject({ titulo: 'Obra', descricao: 'Amanhã' });
  });

  it('update com campo enviado vazio → 400 sem gravar', async () => {
    const { service, prisma } = build();
    await expect(service.update(11, { titulo: ' ' }, sindico)).rejects.toThrow('Informe o título do comunicado.');
    await expect(service.update(11, { descricao: '' }, sindico)).rejects.toThrow('Informe a descrição do comunicado.');
    expect(prisma.comunicados.update).not.toHaveBeenCalled();
  });

  it('update só valida o que veio e grava trimado', async () => {
    const { service, prisma } = build();
    await service.update(11, { titulo: ' Novo ' }, sindico);
    expect(prisma.comunicados.update.mock.calls[0][0].data).toEqual({ titulo: 'Novo' });
  });
});
