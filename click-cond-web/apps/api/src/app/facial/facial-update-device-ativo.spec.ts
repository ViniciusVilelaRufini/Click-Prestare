import { FacialService } from './facial.service';

/**
 * Terminal com histórico de acessos não pode ser excluído (removeDevice
 * devolve 409 e manda desativar). O portal desativa/reativa pelo mesmo PUT de
 * edição — updateDevice tem de aceitar `ativo` e auditar a mudança.
 */
describe('FacialService.updateDevice — desativar/reativar terminal', () => {
  function build(ativo: number) {
    const device: any = {
      id: 1, id_condominio: 10, nome: 'facial principal', tipo: 'facial', ativo,
      ip: '192.168.3.175', porta: 80, api_password: null, id_area_social: null,
    };
    const prisma: any = {
      facial_Devices: {
        findUnique: jest.fn(async () => ({ ...device })),
        findFirst: jest.fn(async () => ({ ...device })),
        update: jest.fn(async ({ data }: any) => Object.assign(device, data)),
      },
    };
    const auditoria: any = { registrar: jest.fn(async () => undefined) };
    const svc = new FacialService(
      prisma, null as any, null as any, null as any, auditoria,
      null as any, null as any, null as any, null as any, null as any,
    );
    return { svc, prisma, auditoria };
  }

  it('desativa (ativo: 0) e audita de 1 para 0', async () => {
    const { svc, prisma, auditoria } = build(1);
    await svc.updateDevice(1, { ativo: 0 });
    expect(prisma.facial_Devices.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ativo: 0 }) }),
    );
    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        detalhes: expect.objectContaining({ changes: expect.objectContaining({ ativo: { de: 1, para: 0 } }) }),
      }),
    );
  });

  it('reativa aceitando booleano (true → 1)', async () => {
    const { svc, prisma } = build(0);
    await svc.updateDevice(1, { ativo: true });
    expect(prisma.facial_Devices.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ativo: 1 }) }),
    );
  });

  it('sem `ativo` no corpo, não mexe no status', async () => {
    const { svc, prisma } = build(1);
    await svc.updateDevice(1, { nome: 'novo nome' });
    const data = prisma.facial_Devices.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('ativo');
  });
});
