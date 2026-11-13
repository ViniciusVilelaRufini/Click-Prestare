import { ConsentimentosService } from './consentimentos.service';
import { ConsentimentosCondominioController } from './consentimentos.controller';

/**
 * A rota do operador conferia só que o morador era do condomínio dele e chamava a revogação do
 * TITULAR: gravava a recusa global (bloqueia cadastro facial em todo condomínio) e tirava rosto e foto
 * dos cadastros de outros condomínios.
 */
describe('Revogação de biometria pelo operador — só no condomínio dele', () => {
  const FOTO_1 = 'https://pub.example.com/moradores/1-a.jpg';
  const FOTO_2 = 'https://pub.example.com/moradores/2-b.jpg';

  function build(contaSoDeste = false) {
    const moradores = [
      { id: 1, id_user: 7, id_condominio: 1, face_id: 'f1', foto_pessoa: FOTO_1 },
      ...(contaSoDeste ? [] : [{ id: 2, id_user: 7, id_condominio: 2, face_id: 'f2', foto_pessoa: FOTO_2 }]),
    ];
    const prisma: any = {
      isConnected: true,
      consentimentos: { create: jest.fn(async () => ({})) },
      moradores: {
        findMany: jest.fn(async ({ where }: any) =>
          moradores.filter((m) => m.id_user === where.id_user && (where.id_condominio === undefined || m.id_condominio === where.id_condominio)),
        ),
        update: jest.fn(async () => ({})),
        count: jest.fn(async ({ where }: any) => (!contaSoDeste && where.id_condominio?.not !== undefined ? 1 : 0)),
      },
      sindicos_Condominios: { count: jest.fn(async () => 0) },
      funcionarios: { count: jest.fn(async () => 0) },
      apartamentos_Users: { count: jest.fn(async () => 0) },
      users: { updateMany: jest.fn(async () => ({ count: 1 })) },
    };
    const facial: any = { unsyncMorador: jest.fn(async () => true) };
    const storage: any = { deleteUrl: jest.fn(async () => true) };
    return { svc: new ConsentimentosService(prisma, facial, storage), prisma, facial, storage };
  }

  it('não grava recusa global e não toca o cadastro do outro condomínio', async () => {
    const { svc, prisma, facial } = build();
    await svc.revogarBiometria(7, 'Portaria', 1);
    expect(prisma.consentimentos.create).not.toHaveBeenCalled();
    expect(facial.unsyncMorador).toHaveBeenCalledWith(1, 'f1', 1);
    expect(facial.unsyncMorador).not.toHaveBeenCalledWith(2, 'f2', 2);
    expect(prisma.moradores.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1 } }));
    expect(prisma.moradores.update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: 2 } }));
  });

  it('conta também de outro condomínio: não apaga a foto do storage nem a foto da conta', async () => {
    const { svc, prisma, storage } = build();
    await svc.revogarBiometria(7, 'Portaria', 1);
    expect(storage.deleteUrl).not.toHaveBeenCalled();
    expect(prisma.users.updateMany).not.toHaveBeenCalled();
  });

  it('conta só deste condomínio: a foto sai do storage e da conta, como antes', async () => {
    const { svc, prisma, storage } = build(true);
    await svc.revogarBiometria(7, 'Portaria', 1);
    expect(storage.deleteUrl).toHaveBeenCalledWith(FOTO_1, expect.anything());
    expect(prisma.users.updateMany).toHaveBeenCalled();
    expect(prisma.consentimentos.create).not.toHaveBeenCalled();
  });

  it('sem condomínio (titular) continua global: grava a recusa e tira o rosto de todos', async () => {
    const { svc, prisma, facial } = build();
    await svc.revogarBiometria(7);
    expect(prisma.consentimentos.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id_user: 7, aceito: 0 }) });
    expect(facial.unsyncMorador).toHaveBeenCalledWith(2, 'f2', 2);
  });

  it('o controller do operador passa o condomínio da rota', async () => {
    const service: any = {
      prismaClient: { moradores: { findUnique: jest.fn(async () => ({ id: 1, id_user: 7, id_condominio: 1 })) } },
      revogarBiometria: jest.fn(async () => ({ ok: true })),
    };
    const ctrl = new ConsentimentosCondominioController(service, {} as any);
    await ctrl.revogarBiometriaMorador(1, 1, { sub: 3, nome: 'Porteiro', id_condominio: 1 } as any);
    expect(service.revogarBiometria).toHaveBeenCalledWith(7, 'Porteiro', 1);
  });
});
