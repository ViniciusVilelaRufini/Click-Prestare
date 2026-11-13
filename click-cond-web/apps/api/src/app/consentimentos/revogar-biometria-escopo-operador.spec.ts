import { ConsentimentosService } from './consentimentos.service';
import { ConsentimentosCondominioController } from './consentimentos.controller';

/**
 * A rota do operador conferia só que o morador era do condomínio dele e chamava a revogação do
 * TITULAR: gravava a recusa global (bloqueia cadastro facial em todo condomínio) e tirava rosto e foto
 * dos cadastros de outros condomínios.
 *
 * No modo do operador a foto sai do storage só se mais nada a referencia (Users da conta ou outro
 * cadastro de morador); Users é global e não é alterado.
 */
describe('Revogação de biometria pelo operador — só no condomínio dele', () => {
  const FOTO_1 = 'https://pub.example.com/moradores/1-a.jpg';
  const FOTO_2 = 'https://pub.example.com/moradores/2-b.jpg';
  const PERFIL = 'https://pub.example.com/moradores/perfil.jpg';

  type Row = { id: number; id_user: number; id_condominio: number; face_id: string | null; foto_pessoa: string | null };
  const daqui = (foto = FOTO_1): Row => ({ id: 1, id_user: 7, id_condominio: 1, face_id: 'f1', foto_pessoa: foto });
  const deOutro = (foto = FOTO_2): Row => ({ id: 2, id_user: 7, id_condominio: 2, face_id: 'f2', foto_pessoa: foto });

  function build(opts: { rows: Row[]; user?: { photo: string | null; profile_image: string | null }; sindicoFora?: number }) {
    const rows = opts.rows;
    const user = opts.user ?? { photo: null, profile_image: null };
    const prisma: any = {
      isConnected: true,
      consentimentos: { create: jest.fn(async () => ({})) },
      moradores: {
        findMany: jest.fn(async ({ where }: any) =>
          rows.filter((m) => m.id_user === where.id_user && (where.id_condominio === undefined || m.id_condominio === where.id_condominio)),
        ),
        update: jest.fn(async ({ where, data }: any) => {
          const r = rows.find((m) => m.id === where.id);
          if (r) Object.assign(r, data);
          return {};
        }),
        count: jest.fn(async ({ where }: any) =>
          rows.filter(
            (m) =>
              (where.foto_pessoa === undefined || m.foto_pessoa === where.foto_pessoa) &&
              (where.id_user === undefined || m.id_user === where.id_user) &&
              (where.id_condominio?.not === undefined || m.id_condominio !== where.id_condominio.not),
          ).length,
        ),
      },
      sindicos_Condominios: { count: jest.fn(async () => opts.sindicoFora ?? 0) },
      funcionarios: { count: jest.fn(async () => 0) },
      apartamentos_Users: { count: jest.fn(async () => 0) },
      users: {
        updateMany: jest.fn(async ({ where, data }: any) => {
          let count = 0;
          for (const k of ['photo', 'profile_image'] as const) {
            if (where.id === 7 && k in data && where[k]?.in?.includes(user[k])) {
              user[k] = data[k];
              count = 1;
            }
          }
          return { count };
        }),
        count: jest.fn(async ({ where }: any) =>
          where.id === 7 &&
          (where.OR ?? []).some(
            (c: any) => (c.photo !== undefined && c.photo === user.photo) || (c.profile_image !== undefined && c.profile_image === user.profile_image),
          )
            ? 1
            : 0,
        ),
      },
    };
    const facial: any = { unsyncMorador: jest.fn(async () => true) };
    const storage: any = { deleteUrl: jest.fn(async () => true) };
    return { svc: new ConsentimentosService(prisma, facial, storage), prisma, facial, storage, rows, user };
  }

  it('não grava recusa global e não toca o cadastro do outro condomínio', async () => {
    const { svc, prisma, facial, rows } = build({ rows: [daqui(), deOutro()] });
    await svc.revogarBiometria(7, 'Portaria', 1);
    expect(prisma.consentimentos.create).not.toHaveBeenCalled();
    expect(facial.unsyncMorador).toHaveBeenCalledWith(1, 'f1', 1);
    expect(facial.unsyncMorador).not.toHaveBeenCalledWith(2, 'f2', 2);
    expect(prisma.moradores.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1 } }));
    expect(prisma.moradores.update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: 2 } }));
    expect(rows[1].foto_pessoa).toBe(FOTO_2);
  });

  it('foto só do cadastro daqui sai do storage, mesmo com cadastro em outro condomínio; Users não muda', async () => {
    const { svc, prisma, storage } = build({ rows: [daqui(), deOutro()] });
    await svc.revogarBiometria(7, 'Portaria', 1);
    expect(storage.deleteUrl).toHaveBeenCalledWith(FOTO_1, expect.anything());
    expect(storage.deleteUrl).not.toHaveBeenCalledWith(FOTO_2, expect.anything());
    expect(prisma.users.updateMany).not.toHaveBeenCalled();
  });

  it('conta compartilhada com outro condomínio: foto que também é a da conta (Users.photo) fica no storage e em Users', async () => {
    const { svc, prisma, storage, user } = build({ rows: [daqui()], user: { photo: FOTO_1, profile_image: null }, sindicoFora: 1 });
    await svc.revogarBiometria(7, 'Portaria', 1);
    expect(storage.deleteUrl).not.toHaveBeenCalled();
    expect(prisma.users.updateMany).not.toHaveBeenCalled();
    expect(user.photo).toBe(FOTO_1);
  });

  it('foto que também está no cadastro de outro condomínio fica no storage', async () => {
    const { svc, storage, rows } = build({ rows: [daqui(FOTO_1), deOutro(FOTO_1)] });
    await svc.revogarBiometria(7, 'Portaria', 1);
    expect(storage.deleteUrl).not.toHaveBeenCalled();
    expect(rows[1].foto_pessoa).toBe(FOTO_1);
  });

  it('outro vínculo só como síndico/funcionário: a foto daqui sai do storage', async () => {
    const { svc, prisma, storage } = build({ rows: [daqui()], user: { photo: PERFIL, profile_image: null }, sindicoFora: 1 });
    await svc.revogarBiometria(7, 'Portaria', 1);
    expect(storage.deleteUrl).toHaveBeenCalledWith(FOTO_1, expect.anything());
    expect(prisma.users.updateMany).not.toHaveBeenCalled();
  });

  it('conta só deste condomínio: a foto sai do storage e da conta, como antes (sem recusa global)', async () => {
    const { svc, prisma, storage, user } = build({ rows: [daqui()], user: { photo: FOTO_1, profile_image: PERFIL } });
    await svc.revogarBiometria(7, 'Portaria', 1);
    expect(prisma.users.updateMany).toHaveBeenCalledWith({ where: { id: 7, photo: { in: [FOTO_1] } }, data: { photo: null } });
    expect(user.photo).toBeNull();
    expect(user.profile_image).toBe(PERFIL);
    expect(storage.deleteUrl).toHaveBeenCalledWith(FOTO_1, expect.anything());
    expect(storage.deleteUrl).not.toHaveBeenCalledWith(PERFIL, expect.anything());
    expect(prisma.consentimentos.create).not.toHaveBeenCalled();
  });

  it('sem condomínio (titular) continua global: grava a recusa e tira rosto e foto de todos', async () => {
    const { svc, prisma, facial, storage } = build({ rows: [daqui(), deOutro()] });
    await svc.revogarBiometria(7);
    expect(prisma.consentimentos.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id_user: 7, aceito: 0 }) });
    expect(facial.unsyncMorador).toHaveBeenCalledWith(2, 'f2', 2);
    expect(storage.deleteUrl).toHaveBeenCalledWith(FOTO_1, expect.anything());
    expect(storage.deleteUrl).toHaveBeenCalledWith(FOTO_2, expect.anything());
    expect(prisma.users.updateMany).toHaveBeenCalled();
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
