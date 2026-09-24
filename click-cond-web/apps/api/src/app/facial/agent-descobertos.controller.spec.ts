import { AgentController } from './agent.controller';
import { AgentBridgeService } from './agent-bridge.service';
import { AgentVersionService } from './agent-version.service';
import { DescobertaService } from './descoberta.service';

/**
 * Rotas do agente para a descoberta na rede (etapa 3):
 *  - GET condo/:token/poll leva `descobrir: true` UMA vez por pedido do portal
 *    (DescobertaService.pedirProcura) — é o sinal para o agente varrer a LAN;
 *  - POST condo/:token/descobertos resolve o condomínio pelo token e entrega o
 *    corpo (não confiável) ao DescobertaService.receber, que sanitiza.
 * Mesma montagem de agent-telemetria.spec.ts (service mockado, bridge real).
 */
describe('AgentController — descoberta na rede', () => {
  function montar() {
    const service: any = {
      resolveCondominioForAgent: jest.fn(async (token: string) => {
        if (token !== 'token-ok') throw new Error('token inválido');
        return 7;
      }),
      getActiveDevices: jest.fn(async () => []),
      syncAllForCondominio: jest.fn(),
    };
    const prisma: any = { facial_Devices: { findMany: jest.fn(async () => []), update: jest.fn() } };
    const descoberta = new DescobertaService(prisma, { registrar: jest.fn() } as any);
    const ctrl = new AgentController(service, new AgentBridgeService(), {} as AgentVersionService, descoberta);
    return { ctrl, service, descoberta };
  }

  it('poll devolve descobrir: true exatamente uma vez depois de pedirProcura', async () => {
    const { ctrl, descoberta } = montar();
    expect((await ctrl.condoPoll('token-ok')).descobrir).toBe(false);
    descoberta.pedirProcura(7);
    expect((await ctrl.condoPoll('token-ok')).descobrir).toBe(true);
    expect((await ctrl.condoPoll('token-ok')).descobrir).toBe(false);
  });

  it('pedido de outro condomínio não vaza para este token', async () => {
    const { ctrl, descoberta } = montar();
    descoberta.pedirProcura(8);
    expect((await ctrl.condoPoll('token-ok')).descobrir).toBe(false);
  });

  it('descobertos resolve o token e delega ao receber com o id do condomínio', async () => {
    const { ctrl, service, descoberta } = montar();
    const receber = jest.spyOn(descoberta, 'receber').mockResolvedValue({ ok: true, ips_corrigidos: 0, macs_aprendidos: 0 });
    const corpo = { achados: [], macs_cadastrados: [] };
    await expect(ctrl.condoDescobertos('token-ok', corpo)).resolves.toEqual({ ok: true, ips_corrigidos: 0, macs_aprendidos: 0 });
    expect(service.resolveCondominioForAgent).toHaveBeenCalledWith('token-ok');
    expect(receber).toHaveBeenCalledWith(7, corpo);
  });

  it('token inválido não chega ao receber', async () => {
    const { ctrl, descoberta } = montar();
    const receber = jest.spyOn(descoberta, 'receber');
    await expect(ctrl.condoDescobertos('token-ruim', {})).rejects.toThrow();
    expect(receber).not.toHaveBeenCalled();
  });
});
