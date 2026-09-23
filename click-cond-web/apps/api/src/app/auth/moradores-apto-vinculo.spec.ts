import { MobileAuthService } from './mobile-auth.service';

/**
 * Caso real (Bloco B): excluir o inquilino do apto 101 pelo app apagava só a
 * linha de Moradores. O vínculo Apartamentos_Users ficava — o usuário seguia
 * com acesso à unidade — e a lista do apto passava a mostrá-lo com
 * `id: m?.id ?? r.id_user`: sem cadastro, o Users.id virava "id de Morador".
 * O Users.id 12 é o Moradores.id 12 de OUTRA pessoa (proprietário do 102):
 * tocar no item abria o cadastro dele, e excluir de novo o apagaria.
 */
describe('Moradores do apartamento — exclusão e lista', () => {
  const sindico = { sub: 1, nome: 'QA síndico', typeAccess: 'Sindico' } as any;

  function montar(prismaExtra: any) {
    const prisma: any = { isConnected: true, ...prismaExtra };
    prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
    const facial: any = { unsyncMorador: jest.fn(async () => true) };
    const tenant: any = { assertEntidade: jest.fn(async () => undefined) };
    const svc = new MobileAuthService(prisma, {} as any, {} as any, {} as any, facial, tenant, {} as any, {} as any, {} as any, {} as any);
    jest.spyOn(svc as any, 'assertAptoDoMorador').mockResolvedValue(undefined);
    return { svc, prisma, facial };
  }

  it('excluir morador remove também o vínculo com os aptos do condomínio e o rosto', async () => {
    const { svc, prisma, facial } = montar({
      moradores: {
        findUnique: jest.fn(async () => ({ id: 11, id_user: 12, id_condominio: 1, face_id: 'f-11', nome: 'QA_SECURITY_20260923' })),
        delete: jest.fn(async () => ({})),
      },
      apartamentos: { findMany: jest.fn(async () => [{ id: 11 }, { id: 12 }]) },
      apartamentos_Users: { deleteMany: jest.fn(async () => ({ count: 1 })) },
    });
    await svc.removeMorador(11, sindico);
    expect(prisma.apartamentos_Users.deleteMany).toHaveBeenCalledWith({
      where: { id_user: 12, id_apto: { in: [11, 12] } },
    });
    expect(prisma.moradores.delete).toHaveBeenCalledWith({ where: { id: 11 } });
    expect(facial.unsyncMorador).toHaveBeenCalledWith(11, 'f-11', 1);
  });

  it('lista do apto nunca usa o Users.id como id de Morador', async () => {
    const { svc } = montar({
      apartamentos: { findUnique: jest.fn(async () => ({ id_condominio: 1 })) },
      apartamentos_Users: {
        findMany: jest.fn(async () => [
          // vínculo órfão: usuário 12 sem cadastro de morador no condomínio
          { id_user: 12, tipo: 'inquilino', apartamento: { id_condominio: 1 }, user: { name: 'Nicolas', moradores: [] } },
          // cadastro em OUTRO condomínio não serve para este
          { id_user: 30, tipo: 'inquilino', apartamento: { id_condominio: 1 },
            user: { name: 'Outro', moradores: [{ id: 99, id_condominio: 2, nome: 'Outro' }] } },
          { id_user: 13, tipo: 'proprietario', apartamento: { id_condominio: 1 },
            user: { name: 'Vinicius', moradores: [{ id: 12, id_condominio: 1, nome: 'Vinicius' }] } },
        ]),
      },
    });
    const lista = await svc.getMoradoresApto(11, undefined, sindico);
    expect(lista.map((m: any) => m.id)).toEqual([12]);
    expect(lista[0].nome).toBe('Vinicius');
  });
});

describe('Painel web — moradores por apartamento', () => {
  it('não usa o Users.id como id de Morador (vínculo sem cadastro fica de fora)', async () => {
    const { MoradoresService } = jest.requireActual('../moradores/moradores.service');
    const prisma: any = {
      isConnected: true,
      apartamentos_Users: {
        findMany: jest.fn(async () => [
          { id_user: 12, tipo: 'inquilino', apartamento: { id_condominio: 1, bloco: 'Bloco B', apto: '101' }, user: { name: 'Nicolas', moradores: [] } },
          { id_user: 30, tipo: 'inquilino', apartamento: { id_condominio: 1 },
            user: { name: 'Outro', moradores: [{ id: 99, id_condominio: 2, nome: 'Outro' }] } },
          { id_user: 13, tipo: 'proprietario', apartamento: { id_condominio: 1 },
            user: { name: 'Vinicius', moradores: [{ id: 12, id_condominio: 1, nome: 'Vinicius' }] } },
        ]),
      },
    };
    const svc = new MoradoresService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any);
    const lista = await svc.findAll(1, undefined, 11);
    expect(lista.map((m: any) => m.id)).toEqual([12]);
  });
});
