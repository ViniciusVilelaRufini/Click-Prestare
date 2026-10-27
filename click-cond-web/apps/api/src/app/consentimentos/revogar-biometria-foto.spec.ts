import { ConsentimentosService } from './consentimentos.service';
import { PREFIXOS_FOTO_MORADOR } from '../common/storage/storage.service';

/**
 * Revogar a biometria zerava `foto_pessoa`, mas o objeto da foto do rosto
 * (public-read em moradores/) ficava no bucket para quem já tinha a URL. E
 * quem tinha foto mas nunca foi enrolado (face_id nulo) ficava até com a
 * foto no banco.
 */
describe('ConsentimentosService.revogarBiometria — foto do rosto', () => {
  const FOTO_A = 'https://pub.example.com/moradores/1-a.jpg';
  const FOTO_B = 'https://pub.example.com/moradores/2-b.jpg';

  function build() {
    const moradores = [
      { id: 1, id_user: 7, id_condominio: 1, face_id: 'x', foto_pessoa: FOTO_A },
      { id: 2, id_user: 7, id_condominio: 1, face_id: null, foto_pessoa: FOTO_B },
    ];
    const prisma: any = {
      isConnected: true,
      consentimentos: { create: jest.fn(async () => ({})) },
      moradores: {
        findMany: jest.fn(async () => moradores),
        update: jest.fn(async ({ where, data }: any) => Object.assign(moradores.find((m) => m.id === where.id)!, data)),
      },
      users: { updateMany: jest.fn(async () => ({ count: 1 })) },
    };
    const facial: any = { unsyncMorador: jest.fn(async () => true) };
    const storage: any = { deleteUrl: jest.fn(async () => true) };
    return { svc: new ConsentimentosService(prisma, facial, storage), prisma, storage, moradores };
  }

  it('apaga do storage a foto de todos os moradores do titular, só dentro de moradores/', async () => {
    const { svc, storage } = build();
    await svc.revogarBiometria(7);
    expect(storage.deleteUrl).toHaveBeenCalledWith(FOTO_A, PREFIXOS_FOTO_MORADOR);
    expect(storage.deleteUrl).toHaveBeenCalledWith(FOTO_B, PREFIXOS_FOTO_MORADOR);
  });

  it('morador sem face_id também perde a foto no banco', async () => {
    const { svc, moradores } = build();
    await svc.revogarBiometria(7);
    expect(moradores[1].foto_pessoa).toBeNull();
    expect(moradores[0].foto_pessoa).toBeNull();
  });

  it('limpa Users.photo/profile_image que apontavam para a foto apagada', async () => {
    const { svc, prisma } = build();
    await svc.revogarBiometria(7);
    expect(prisma.users.updateMany).toHaveBeenCalledWith({
      where: { id: 7, photo: { in: [FOTO_A, FOTO_B] } },
      data: { photo: null },
    });
    expect(prisma.users.updateMany).toHaveBeenCalledWith({
      where: { id: 7, profile_image: { in: [FOTO_A, FOTO_B] } },
      data: { profile_image: null },
    });
  });
});
