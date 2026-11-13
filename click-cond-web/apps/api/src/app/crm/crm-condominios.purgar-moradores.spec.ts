import { CrmCondominiosService } from './crm-condominios.service';
import { PREFIXOS_FOTO_MORADOR } from '../common/storage/storage.service';

/**
 * Moradores.id_condominio é anulável e fk_mor_cond é ON DELETE SET NULL: o delete do condomínio
 * deixava cada cadastro de morador (nome, CPF, fotos, tag, QR) com id_condominio NULL. A conta
 * ficava presa a essa linha (removerContasOrfas a contava como vínculo) e as fotos seguiam no bucket.
 */
describe('CrmCondominiosService.purgar — cadastros de morador não ficam órfãos', () => {
  const FOTO = 'https://bucket-qa.s3.amazonaws.com/moradores/1700000000000-qa.jpg';

  function build(opts: { refsFoto?: number } = {}) {
    const ordem: string[] = [];
    const linhas = [{ id_user: 7, foto_pessoa: FOTO, foto_documento: null }];
    const prisma: any = {
      condominios: {
        findUnique: jest.fn(async () => ({ id: 1, nome: 'Cond QA', ativo: 0 })),
        delete: jest.fn(async () => {
          ordem.push('delete-condominio');
          return {};
        }),
      },
      vagas: {
        deleteMany: jest.fn(async () => {
          ordem.push('delete-vagas');
          return { count: 1 };
        }),
      },
      acessos_Facial: { count: jest.fn(async () => 0), deleteMany: jest.fn() },
      facial_Devices: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
      sindicos_Condominios: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
      moradores: {
        findMany: jest.fn(async () => linhas),
        deleteMany: jest.fn(async () => {
          ordem.push('delete-moradores');
          return { count: 1 };
        }),
        count: jest.fn(async ({ where }: any) => {
          if (where.id_condominio === 1) return 1; // contar()
          if (where.id_user === 7) {
            // Sobrou uma linha órfã (id_condominio NULL, de purga anterior): não é vínculo.
            return where.id_condominio?.not === null ? 0 : 1;
          }
          return opts.refsFoto ?? 0; // outra referência à mesma foto
        }),
      },
      funcionarios: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
      apartamentos: { count: jest.fn(async () => 0) },
      apartamentos_Users: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
      users: { delete: jest.fn(async () => ({})), count: jest.fn(async () => 0) },
      auditLog: { updateMany: jest.fn(async () => ({ count: 0 })) },
      chat_Ia_Historico: { deleteMany: jest.fn(async () => ({ count: 0 })) },
      rag_Embeddings: { deleteMany: jest.fn(async () => ({ count: 0 })) },
      fechamentoMensal: { deleteMany: jest.fn(async () => ({ count: 0 })) },
      crm_Faturas: { deleteMany: jest.fn() },
      crm_Disparos: { deleteMany: jest.fn() },
      $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
    };
    const auditoria: any = { registrar: jest.fn(async () => undefined) };
    const deviceClient: any = { listUserIds: jest.fn(async () => []), removeUsers: jest.fn() };
    const storage: any = { deleteUrl: jest.fn(async () => true) };
    const svc = new CrmCondominiosService(prisma, auditoria, deviceClient, storage);
    return { svc, prisma, storage, ordem };
  }

  it('apaga os Moradores do condomínio na mesma transação, ANTES do condomínio', async () => {
    const { svc, prisma, ordem } = build();
    await svc.purgar(1, 'Cond QA', 'op@x.com');
    expect(prisma.moradores.deleteMany).toHaveBeenCalledWith({ where: { id_condominio: 1 } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(ordem).toEqual(['delete-vagas', 'delete-moradores', 'delete-condominio']);
  });

  it('apaga as Vagas do condomínio antes dos Moradores (fk_vaga_benef é RESTRICT)', async () => {
    const { svc, prisma } = build();
    await svc.purgar(1, 'Cond QA', 'op@x.com');
    expect(prisma.vagas.deleteMany).toHaveBeenCalledWith({ where: { id_condominio: 1 } });
  });

  it('linha órfã (id_condominio NULL) não preserva a conta', async () => {
    const { svc, prisma } = build();
    const r = await svc.purgar(1, 'Cond QA', 'op@x.com');
    expect(prisma.users.delete).toHaveBeenCalledWith({ where: { id: 7 } });
    expect(r.contasRemovidas).toBe(1);
    expect(r.contasPreservadas).toBe(0);
  });

  it('apaga do storage a foto do cadastro que mais nada referencia', async () => {
    const { svc, storage } = build();
    await svc.purgar(1, 'Cond QA', 'op@x.com');
    expect(storage.deleteUrl).toHaveBeenCalledWith(FOTO, PREFIXOS_FOTO_MORADOR);
  });

  it('foto ainda usada em outro cadastro/conta fica no storage', async () => {
    const { svc, storage } = build({ refsFoto: 1 });
    await svc.purgar(1, 'Cond QA', 'op@x.com');
    expect(storage.deleteUrl).not.toHaveBeenCalled();
  });

  it('não apaga faturas nem disparos do CRM', async () => {
    const { svc, prisma } = build();
    await svc.purgar(1, 'Cond QA', 'op@x.com');
    expect(prisma.crm_Faturas.deleteMany).not.toHaveBeenCalled();
    expect(prisma.crm_Disparos.deleteMany).not.toHaveBeenCalled();
  });
});
