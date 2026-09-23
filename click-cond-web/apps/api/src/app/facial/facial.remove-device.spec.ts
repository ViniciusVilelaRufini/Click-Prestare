import { ConflictException } from '@nestjs/common';
import { FacialService } from './facial.service';

describe('FacialService.removeDevice — recusa quando o terminal tem histórico de acessos', () => {
  function build(totalAcessos: number) {
    const device = {
      id: 9,
      id_condominio: 1,
      nome: 'Portaria Principal',
      tipo: 'facial',
      ip: '10.0.0.9',
      id_area_social: null,
      api_password: null,
    };

    const prisma: any = {
      facial_Devices: {
        findUnique: jest.fn(async () => device),
        delete: jest.fn(async () => device),
      },
      acessos_Facial: {
        count: jest.fn(async () => totalAcessos),
      },
      regras_Dispositivos: {
        findMany: jest.fn(async () => []),
      },
    };

    const auditoria: any = { registrar: jest.fn(async () => undefined) };

    // O construtor tem 10 parâmetros, nessa ordem: prisma, client,
    // notifications, enrollSessions, auditoria, accessState, agent, tenant,
    // consentimentos, consentimentosTerceiros. removeDevice só usa prisma e
    // auditoria (via getDevice/flagsControleAcessoPorArea, que não toca em
    // área social aqui pois id_area_social é null).
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
    return { svc, prisma, auditoria, device };
  }

  it('recusa com ConflictException quando há acessos registrados, e NÃO apaga o dispositivo', async () => {
    const { svc, prisma } = build(12);

    await expect(svc.removeDevice(9)).rejects.toThrow(ConflictException);

    expect(prisma.facial_Devices.delete).not.toHaveBeenCalled();
  });

  it('a mensagem de recusa cita a contagem e orienta a desativar (ativo=0) em vez de excluir', async () => {
    const { svc } = build(12);

    await expect(svc.removeDevice(9)).rejects.toThrow(/12/);
    await expect(svc.removeDevice(9)).rejects.toThrow(/ativo/i);
  });

  it('registra a tentativa recusada na auditoria', async () => {
    const { svc, auditoria } = build(5);

    await expect(svc.removeDevice(9)).rejects.toThrow(ConflictException);

    expect(auditoria.registrar).toHaveBeenCalledTimes(1);
    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ id_condominio: 1, entidade_id: 9, acao: 'DEVICE_CHANGE' }),
    );
  });

  it('permite excluir quando não há acessos registrados (fluxo antigo continua funcionando)', async () => {
    const { svc, prisma, auditoria } = build(0);

    const resultado = await svc.removeDevice(9);

    expect(resultado).toEqual({ ok: true });
    expect(prisma.facial_Devices.delete).toHaveBeenCalledWith({ where: { id: 9 } });
    expect(auditoria.registrar).toHaveBeenCalledTimes(1);
    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ acao: 'DEVICE_CHANGE', entidade_id: 9 }),
    );
  });
});
