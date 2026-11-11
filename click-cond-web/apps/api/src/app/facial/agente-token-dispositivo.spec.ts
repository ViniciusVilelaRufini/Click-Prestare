import { Logger, UnauthorizedException } from '@nestjs/common';
import { FacialService } from './facial.service';

/**
 * Token de DISPOSITIVO usado como token do AGENTE (compatibilidade com agente
 * antigo). O fallback continua valendo; o que muda é que o serviço passa a
 * dizer que a autenticação veio por esse caminho (e por qual dispositivo) e
 * avisa no log — no máximo uma vez por token a cada hora.
 */
describe('FacialService — autenticação do agente por token de dispositivo', () => {
  function build() {
    const prisma: any = {
      condominios: {
        findFirst: jest.fn(async ({ where }: any) =>
          where.agent_token === 'tok-agente' ? { id: 10 } : null,
        ),
      },
      facial_Devices: {
        findFirst: jest.fn(async ({ where }: any) =>
          where.webhook_token === 'tok-device'
            ? { id: 7, id_condominio: 10 }
            : where.webhook_token === 'tok-device-2'
              ? { id: 8, id_condominio: 10 }
              : null,
        ),
      },
    };
    const svc = new FacialService(
      prisma, null as any, null as any, null as any, null as any,
      null as any, null as any, null as any, null as any, null as any,
    );
    return { svc, prisma };
  }

  let warn: jest.SpyInstance;
  beforeEach(() => {
    jest.useFakeTimers();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    warn.mockRestore();
    jest.useRealTimers();
  });

  const avisos = () => warn.mock.calls.filter((c) => /token de dispositivo/i.test(String(c[0])));

  it('agent_token do condomínio: resolve sem marcar token de dispositivo e sem aviso', async () => {
    const { svc } = build();

    await expect(svc.resolveAgente('tok-agente')).resolves.toEqual({ idCondominio: 10 });
    expect(avisos()).toHaveLength(0);
  });

  it('token de dispositivo: continua aceito e informa o dispositivo de origem', async () => {
    const { svc } = build();

    await expect(svc.resolveAgente('tok-device')).resolves.toEqual({
      idCondominio: 10,
      viaTokenDispositivo: true,
      idDispositivo: 7,
    });
  });

  it('resolveCondominioForAgent continua devolvendo só o id do condomínio (chamadores atuais)', async () => {
    const { svc } = build();

    await expect(svc.resolveCondominioForAgent('tok-agente')).resolves.toBe(10);
    await expect(svc.resolveCondominioForAgent('tok-device')).resolves.toBe(10);
  });

  it('token inválido continua 401', async () => {
    const { svc } = build();

    await expect(svc.resolveCondominioForAgent('nada')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(svc.resolveAgente('nada')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('avisa no log uma vez por token a cada hora, sem escrever o token', async () => {
    const { svc } = build();

    await svc.resolveCondominioForAgent('tok-device');
    await svc.resolveCondominioForAgent('tok-device');
    await svc.resolveAgente('tok-device');
    expect(avisos()).toHaveLength(1);
    expect(String(avisos()[0][0])).toMatch(/dispositivo 7/);
    expect(String(avisos()[0][0])).toMatch(/condomínio 10/);
    expect(String(avisos()[0][0])).not.toContain('tok-device');

    // Outro token tem o seu próprio limite.
    await svc.resolveCondominioForAgent('tok-device-2');
    expect(avisos()).toHaveLength(2);

    jest.advanceTimersByTime(59 * 60 * 1000);
    await svc.resolveCondominioForAgent('tok-device');
    expect(avisos()).toHaveLength(2);

    jest.advanceTimersByTime(2 * 60 * 1000);
    await svc.resolveCondominioForAgent('tok-device');
    expect(avisos()).toHaveLength(3);
  });
});
