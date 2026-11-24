import { FacialService } from './facial.service';

/**
 * O chamado de "aparelho offline" é achado pela descrição (nome + tipo). Dois
 * aparelhos ativos com o mesmo nome e tipo no condomínio geram a MESMA
 * descrição: renomear ou excluir um fechava o chamado do outro, que segue
 * offline. Com um homônimo ativo, o chamado fica aberto — o monitor fecha
 * quando o aparelho certo voltar.
 */
describe('FacialService — chamado offline de aparelhos com o mesmo nome', () => {
  function build(homonimosAtivos: number) {
    const device: any = {
      id: 9, id_condominio: 1, nome: 'Portaria', tipo: 'facial', ativo: 1,
      ip: '10.0.0.9', porta: 80, api_password: null, id_area_social: null, fabricante: 'intelbras',
    };
    const prisma: any = {
      facial_Devices: {
        findUnique: jest.fn(async () => ({ ...device })),
        findFirst: jest.fn(async () => null),
        update: jest.fn(async ({ data }: any) => Object.assign(device, data)),
        delete: jest.fn(async () => device),
        count: jest.fn(async () => homonimosAtivos),
      },
      acessos_Facial: { count: jest.fn(async () => 0) },
      deliveryPedidosPortao: { count: jest.fn(async () => 0) },
      regras_Dispositivos: { findMany: jest.fn(async () => []) },
      ocorrencias: { updateMany: jest.fn(async () => ({ count: 1 })) },
    };
    const auditoria: any = { registrar: jest.fn(async () => undefined) };
    // T1: excluir/trocar o tipo de um facial ativo apaga os rostos antes (agente online).
    const client: any = { listUserIds: jest.fn(async () => []), removeUsers: jest.fn(async () => undefined) };
    const agent: any = { isOnline: jest.fn(() => true) };
    const svc = new FacialService(
      prisma, client, null as any, null as any, auditoria,
      null as any, agent, null as any, null as any, null as any,
    );
    return { svc, prisma };
  }

  it('renomear com outro aparelho ativo de mesmo nome e tipo: o chamado fica aberto', async () => {
    const { svc, prisma } = build(1);
    await svc.updateDevice(9, { nome: 'Portaria Social' });
    expect(prisma.ocorrencias.updateMany).not.toHaveBeenCalled();
    expect(prisma.facial_Devices.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ id_condominio: 1, nome: 'Portaria', ativo: 1, id: { not: 9 } }),
    });
  });

  it('excluir com homônimo ativo: o chamado fica aberto e a exclusão segue', async () => {
    const { svc, prisma } = build(2);
    await expect(svc.removeDevice(9)).resolves.toEqual({ ok: true });
    expect(prisma.ocorrencias.updateMany).not.toHaveBeenCalled();
  });

  it('sem homônimo ativo: fecha como antes', async () => {
    const { svc, prisma } = build(0);
    await svc.removeDevice(9);
    expect(prisma.ocorrencias.updateMany).toHaveBeenCalled();
  });

  it('tipo "facial" casa com o tipo vazio, que a descrição também escreve como facial', async () => {
    const { svc, prisma } = build(0);
    await svc.removeDevice(9);
    const where = prisma.facial_Devices.count.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ tipo: 'facial' }, { tipo: '' }]);
  });

  it('trocar o tipo procura homônimos do nome e tipo ANTIGOS (os da descrição do chamado)', async () => {
    const { svc, prisma } = build(0);
    await svc.updateDevice(9, { tipo: 'lpr' } as any);
    const where = prisma.facial_Devices.count.mock.calls[0][0].where;
    expect(where).toMatchObject({ nome: 'Portaria', OR: [{ tipo: 'facial' }, { tipo: '' }] });
  });

  it('aparelho de outro tipo compara o tipo exato', async () => {
    const { svc, prisma } = build(0);
    prisma.facial_Devices.findUnique.mockResolvedValue({
      id: 9, id_condominio: 1, nome: 'Garagem', tipo: 'lpr', ativo: 1, ip: '10.0.0.9', porta: 80,
    });
    await svc.removeDevice(9);
    const where = prisma.facial_Devices.count.mock.calls[0][0].where;
    expect(where).toMatchObject({ nome: 'Garagem', tipo: 'lpr' });
    expect(where.OR).toBeUndefined();
  });
});
