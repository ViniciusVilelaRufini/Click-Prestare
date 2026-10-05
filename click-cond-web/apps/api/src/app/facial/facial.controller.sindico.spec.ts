import { ForbiddenException } from '@nestjs/common';
import { FacialController } from './facial.controller';
import { AgentBridgeService } from './agent-bridge.service';
import { AgentVersionService } from './agent-version.service';

/**
 * Gestão de terminais é do síndico: o portal só escondia o menu, então um
 * porteiro com o token na mão chamava a API direto (apagar terminal, girar o
 * token do webhook, baixar o segredo do agente, limpar rostos). Rotas do dia a
 * dia da portaria (abrir porta, testar, listar, sync) seguem com o operador.
 */
describe('FacialController — gestão de terminais só para síndico', () => {
  const COND = 10;
  const porteiro = { sub: 3, nome: 'Porteiro', id_condominio: COND, turno: 'Diurno' } as any;
  const sindico = { sub: 1, nome: 'Síndico', id_condominio: COND, turno: 'Síndico', typeAccess: 'Sindico' } as any;

  function montar() {
    const service: any = {
      getDevice: jest.fn(async () => ({ id: 5, id_condominio: COND })),
      createDevice: jest.fn(async () => ({ id: 5 })),
      updateDevice: jest.fn(async () => ({ id: 5 })),
      removeDevice: jest.fn(async () => ({ ok: true })),
      rotateWebhookToken: jest.fn(async () => ({ ok: true })),
      unsyncAllForCondominio: jest.fn(async () => ({ ok: true })),
      getAgentInfo: jest.fn(async () => ({ agent_token: 'seg', download_url: 'u' })),
      getAgentConfigFile: jest.fn(async () => ({ filename: 'a.env', content: 'x', contentType: 'text/plain' })),
      triggerDevice: jest.fn(async () => ({ ok: true })),
      testDevice: jest.fn(async () => ({ ok: true })),
      listDevices: jest.fn(async () => []),
      syncAllForCondominio: jest.fn(async () => ({ ok: true })),
    };
    const descoberta: any = { listar: jest.fn(), pedirProcura: jest.fn() };
    const ctrl = new FacialController(
      service,
      new AgentBridgeService(),
      { getLatest: jest.fn() } as unknown as AgentVersionService,
      descoberta,
    );
    const res: any = { setHeader: jest.fn(), send: jest.fn() };
    return { ctrl, service, descoberta, res };
  }

  const acoesDeSindico: Array<[string, (c: FacialController, u: any, res: any) => any, string]> = [
    ['POST devices', (c, u) => c.create({ id_condominio: COND } as any, u), 'createDevice'],
    ['PUT devices/:id', (c, u) => c.update(5, {} as any, u), 'updateDevice'],
    ['DELETE devices/:id', (c, u) => c.remove(5, u), 'removeDevice'],
    ['POST devices/:id/rotate-token', (c, u) => c.rotateToken(5, u), 'rotateWebhookToken'],
    ['POST sync/clean', (c, u) => c.unsyncAll(COND, u), 'unsyncAllForCondominio'],
    ['GET agent/info', (c, u) => c.agentInfo(COND, u), 'getAgentInfo'],
    ['GET agent/config', (c, u, res) => c.agentConfig(COND, u, {} as any, res), 'getAgentConfigFile'],
  ];

  it.each(acoesDeSindico)('%s: porteiro recebe 403 e o service não é chamado', async (_n, chamar, metodo) => {
    const { ctrl, service, res } = montar();
    await expect(Promise.resolve().then(() => chamar(ctrl, porteiro, res))).rejects.toThrow(ForbiddenException);
    expect(service[metodo]).not.toHaveBeenCalled();
  });

  it.each(acoesDeSindico)('%s: síndico passa', async (_n, chamar, metodo) => {
    const { ctrl, service, res } = montar();
    await expect(Promise.resolve().then(() => chamar(ctrl, sindico, res))).resolves.not.toThrow();
    expect(service[metodo]).toHaveBeenCalled();
  });

  it('rotas operacionais seguem liberadas ao porteiro', async () => {
    const { ctrl, service, descoberta } = montar();
    await expect(ctrl.trigger(5, porteiro)).resolves.toBeDefined();
    await expect(ctrl.test(5, porteiro)).resolves.toBeDefined();
    await expect(ctrl.list(COND, porteiro)).resolves.toBeDefined();
    await expect(ctrl.syncAll(COND, porteiro)).resolves.toBeDefined();
    await expect(ctrl.procurarDescobertos(COND, porteiro)).resolves.toEqual({ ok: true });
    expect(service.triggerDevice).toHaveBeenCalled();
    expect(descoberta.pedirProcura).toHaveBeenCalledWith(COND);
  });

  it('síndico também passa nas rotas operacionais', async () => {
    const { ctrl } = montar();
    await expect(ctrl.trigger(5, sindico)).resolves.toBeDefined();
  });
});
