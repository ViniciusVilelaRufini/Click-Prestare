import { FacialService } from './facial.service';

describe('FacialService.createDevice — grava mac normalizado e numero_serie', () => {
  function build() {
    const created: any = {};
    const prisma: any = {
      facial_Devices: {
        create: jest.fn(async ({ data }: any) => {
          Object.assign(created, { id: 1 }, data);
          return created;
        }),
      },
    };
    const auditoria: any = { registrar: jest.fn(async () => undefined) };

    // O construtor tem 10 parâmetros, nessa ordem: prisma, client,
    // notifications, enrollSessions, auditoria, accessState, agent, tenant,
    // consentimentos, consentimentosTerceiros. createDevice só usa prisma e
    // auditoria.
    const svc = new FacialService(
      prisma,
      null as any,
      null as any,
      null as any,
      auditoria,
      null as any,
      null as any,
      null as any,
      null as any,
      null as any,
    );
    return { svc, prisma, created };
  }

  it('normaliza o mac (com separador -) para minúsculo com :', async () => {
    const { svc, prisma } = build();

    await svc.createDevice({
      id_condominio: 1,
      nome: 'Facial principal',
      fabricante: 'intelbras',
      ip: '192.168.3.175',
      mac: 'B4-4C-3B-F4-E3-01',
      numero_serie: 'K3LJ3400209RH',
    } as any);

    expect(prisma.facial_Devices.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          mac: 'b4:4c:3b:f4:e3:01',
          numero_serie: 'K3LJ3400209RH',
        }),
      }),
    );
  });

  it('sem mac/numero_serie, grava null (não quebra o cadastro manual de sempre)', async () => {
    const { svc, prisma } = build();

    await svc.createDevice({
      id_condominio: 1,
      nome: 'Facial principal',
      fabricante: 'intelbras',
      ip: '192.168.3.175',
    } as any);

    expect(prisma.facial_Devices.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ mac: null, numero_serie: null }),
      }),
    );
  });
});
