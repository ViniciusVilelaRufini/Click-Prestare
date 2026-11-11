import { ForbiddenException } from '@nestjs/common';
import { FacialController } from './facial.controller';
import { AgentBridgeService } from './agent-bridge.service';
import { AgentVersionService } from './agent-version.service';

/**
 * `POST /facial/enroll/start` abre uma sessão que desvia a PRÓXIMA leitura do
 * leitor (tag/QR/placa) para captura, em vez de virar acesso — morador não
 * pode abrir essa sessão.
 *
 * Teste de CARACTERIZAÇÃO: a rota já barra o morador. `assertTenantStrict`
 * exige `id_condominio` no token, e só o token do console da portaria o
 * carrega (o do app — morador ou síndico — não). Fica aqui para travar esse
 * comportamento caso a checagem de tenant da rota seja afrouxada.
 */
describe('FacialController — enroll/start exige operador', () => {
  const COND = 10;
  const porteiro = { sub: 3, nome: 'Porteiro', id_condominio: COND, turno: 'Diurno' } as any;
  const sindico = { sub: 1, nome: 'Síndico', id_condominio: COND, typeAccess: 'Sindico' } as any;
  const morador = { sub: 7, typeAccess: 'Morador', user: { typeAccess: 'Morador' } } as any;

  function montar() {
    const service: any = {
      getDevice: jest.fn(async () => ({ id: 5, id_condominio: COND, nome: 'Leitor' })),
      startEnrollCapture: jest.fn(async () => ({ sessionId: 's1' })),
    };
    const ctrl = new FacialController(
      service,
      new AgentBridgeService(),
      { getLatest: jest.fn() } as unknown as AgentVersionService,
      { listar: jest.fn(), pedirProcura: jest.fn() } as any,
    );
    return { ctrl, service };
  }

  it('morador recebe 403 e nenhuma sessão de captura é aberta', async () => {
    const { ctrl, service } = montar();

    await expect(ctrl.startEnroll({ id_device: 5 }, morador)).rejects.toThrow(ForbiddenException);

    expect(service.startEnrollCapture).not.toHaveBeenCalled();
  });

  it.each([
    ['porteiro', porteiro],
    ['síndico', sindico],
  ])('%s abre a sessão de captura', async (_nome, user) => {
    const { ctrl, service } = montar();

    await expect(ctrl.startEnroll({ id_device: 5 }, user)).resolves.toEqual({ sessionId: 's1' });

    expect(service.startEnrollCapture).toHaveBeenCalledWith(5);
  });

  it('operador de OUTRO condomínio continua barrado', async () => {
    const { ctrl, service } = montar();

    await expect(
      ctrl.startEnroll({ id_device: 5 }, { ...porteiro, id_condominio: 99 }),
    ).rejects.toThrow(ForbiddenException);

    expect(service.startEnrollCapture).not.toHaveBeenCalled();
  });
});
