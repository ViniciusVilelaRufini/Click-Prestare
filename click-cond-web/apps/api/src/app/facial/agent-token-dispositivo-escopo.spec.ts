import { UnauthorizedException } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentBridgeService } from './agent-bridge.service';
import { AgentVersionService } from './agent-version.service';
import { FacialService } from './facial.service';

/**
 * O webhook_token de UM dispositivo (vai em URL de webhook, cai em log de proxy) resolvia o condomínio
 * inteiro nas rotas condo/:token/*: senha de todos os aparelhos, comandos (fotos de enrolamento) de
 * todos, eventos e status em nome de qualquer um. Agora ele vale só para o próprio dispositivo.
 */
describe('Agente — token de dispositivo nas rotas condo/*: escopo só do dispositivo', () => {
  // Condomínio 7: devices 5 (tok-5) e 6 (tok-6); agent_token do condomínio: tok-condo-7.
  // Condomínio 8: device 9 (tok-9) e nenhum agent_token configurado (agente instalado com a URL do webhook).
  const devices = [
    { id: 5, id_condominio: 7, nome: 'T5', tipo: 'facial', fabricante: 'intelbras', ip: '192.168.1.5', porta: 80, api_user: 'admin', api_password: 'senha-5', ultima_sincr: new Date() },
    { id: 6, id_condominio: 7, nome: 'T6', tipo: 'facial', fabricante: 'intelbras', ip: '192.168.1.6', porta: 80, api_user: 'admin', api_password: 'senha-6', ultima_sincr: new Date() },
    { id: 9, id_condominio: 8, nome: 'T9', tipo: 'facial', fabricante: 'intelbras', ip: '192.168.1.9', porta: 80, api_user: 'admin', api_password: 'senha-9', ultima_sincr: new Date() },
  ];
  const resolver = async (token: string) => {
    if (token === 'tok-condo-7') return { idCondominio: 7 };
    const d = devices.find((x) => `tok-${x.id}` === token);
    if (!d) throw new UnauthorizedException('Token do agente inválido');
    return {
      idCondominio: d.id_condominio,
      viaTokenDispositivo: true,
      idDispositivo: d.id,
      ...(d.id_condominio === 8 && { condominioSemAgentToken: true }),
    };
  };

  function montar() {
    const service: any = {
      resolveAgente: jest.fn(resolver),
      // Comportamento atual (escopo amplo) — o controller não deve mais depender dele.
      resolveCondominioForAgent: jest.fn(async (t: string) => (await resolver(t)).idCondominio),
      getActiveDevices: jest.fn(async (id: number) => devices.filter((d) => d.id_condominio === id).map((d) => ({ ...d }))),
      syncAllForCondominio: jest.fn(async () => undefined),
      reportDeviceStatuses: jest.fn(async () => ({ ok: true })),
    };
    const bridge = new AgentBridgeService();
    const descoberta: any = { consumirPedido: jest.fn(async () => true), receber: jest.fn(async () => ({ ok: true })) };
    const ctrl = new AgentController(service, bridge, {} as AgentVersionService, descoberta);
    return { ctrl, service, bridge, descoberta };
  }

  it('poll com token de dispositivo devolve só ele (sem a senha dos outros) e não consome a descoberta', async () => {
    const { ctrl, descoberta } = montar();
    const res: any = await ctrl.condoPoll('tok-5');
    expect(res.devices.map((d: any) => d.device.id)).toEqual([5]);
    expect(JSON.stringify(res)).not.toContain('senha-6');
    expect(res.descobrir).toBe(false);
    expect(descoberta.consumirPedido).not.toHaveBeenCalled();
  });

  it('poll com agent_token continua devolvendo o condomínio inteiro', async () => {
    const { ctrl } = montar();
    const res: any = await ctrl.condoPoll('tok-condo-7');
    expect(res.devices.map((d: any) => d.device.id)).toEqual([5, 6]);
    expect(res.descobrir).toBe(true);
  });

  it('result com token de dispositivo não resolve comando de outro dispositivo', async () => {
    const { ctrl, bridge } = montar();
    await bridge.poll(5);
    const promessa = bridge.enqueue(5, { type: 'open_door' });
    const [cmd] = await bridge.poll(5);
    let resolvido: any = null;
    void promessa.then((v) => (resolvido = v));

    await ctrl.condoResult('tok-6', { commandId: cmd.id, ok: true } as any);
    await new Promise((r) => setImmediate(r));
    expect(resolvido).toBeNull();

    await ctrl.condoResult('tok-5', { commandId: cmd.id, ok: true, statusCode: 200 } as any);
    await expect(promessa).resolves.toEqual({ ok: true, statusCode: 200 });
  });

  it('device-status com token de dispositivo só repassa o status dele', async () => {
    const { ctrl, service } = montar();
    await ctrl.condoDeviceStatus('tok-5', { statuses: [{ deviceId: 5, online: true }, { deviceId: 6, online: false }] });
    expect(service.reportDeviceStatuses).toHaveBeenCalledWith(7, [{ deviceId: 5, online: true }]);
  });

  it('telemetria e descobertos com token de dispositivo não gravam nada do condomínio', async () => {
    const { ctrl, bridge, descoberta } = montar();
    await expect(ctrl.condoTelemetria('tok-5', { versao: 'x', dispositivos: [] })).resolves.toEqual({ ok: true });
    expect(await bridge.getTelemetria(7)).toBeNull();
    await expect(ctrl.condoDescobertos('tok-5', { achados: [], macs_cadastrados: [] })).resolves.toEqual(
      expect.objectContaining({ ok: true }),
    );
    expect(descoberta.receber).not.toHaveBeenCalled();
  });

  it('versao com token de dispositivo continua valendo (auto-atualização do agente antigo)', async () => {
    const { service, bridge, descoberta } = montar();
    const info = { versao: '2026.11.13', url: 'https://gh/click-agent.exe', sha256: 'a'.repeat(64) };
    const agentVersion: any = { getLatest: jest.fn(async () => info) };
    const ctrl = new AgentController(service, bridge, agentVersion, descoberta);
    await expect(ctrl.condoVersao('tok-5')).resolves.toEqual(info);
    expect(service.resolveAgente).toHaveBeenCalledWith('tok-5');
  });

  // O pedido "Atualizar agora" é do condomínio (como a descoberta): o token de um dispositivo não o
  // consome, senão o agente do condomínio nunca recebia o pedido feito no portal.
  it('poll com token de dispositivo não consome o verificar_atualizacao; o agent_token recebe uma vez', async () => {
    const { ctrl, bridge } = montar();
    await bridge.pedirVerificacaoDeAtualizacao(7);
    expect((await ctrl.condoPoll('tok-5')).verificar_atualizacao).toBe(false);
    expect((await ctrl.condoPoll('tok-6')).verificar_atualizacao).toBe(false);
    expect((await ctrl.condoPoll('tok-condo-7')).verificar_atualizacao).toBe(true);
    expect((await ctrl.condoPoll('tok-condo-7')).verificar_atualizacao).toBe(false);
  });

  // Instalações em que o agente foi configurado com a URL do webhook de um dispositivo: o condomínio não
  // tem agent_token, então o "Atualizar agora" do portal só chega por esse token.
  it('condomínio SEM agent_token: o token de dispositivo consome o verificar_atualizacao uma vez', async () => {
    const { ctrl, bridge } = montar();
    await bridge.pedirVerificacaoDeAtualizacao(8);
    expect((await ctrl.condoPoll('tok-9')).verificar_atualizacao).toBe(true);
    expect((await ctrl.condoPoll('tok-9')).verificar_atualizacao).toBe(false);
  });

  it('condomínio SEM agent_token: o token de dispositivo continua sem consumir a descoberta', async () => {
    const { ctrl, descoberta } = montar();
    expect((await ctrl.condoPoll('tok-9')).descobrir).toBe(false);
    expect(descoberta.consumirPedido).not.toHaveBeenCalled();
  });

  describe('FacialService', () => {
    function build() {
      const prisma: any = {
        condominios: { findFirst: jest.fn(async ({ where }: any) => (where.agent_token === 'tok-condo-7' ? { id: 7 } : null)) },
        facial_Devices: {
          findFirst: jest.fn(async ({ where }: any) => {
            if (where.webhook_token === 'tok-9') return { id: 9, id_condominio: 8, condominio: { agent_token: null } };
            if (where.webhook_token === 'tok-vazio') return { id: 10, id_condominio: 8, condominio: { agent_token: '  ' } };
            if (where.webhook_token) return where.webhook_token === 'tok-5' ? { id: 5, id_condominio: 7, condominio: { agent_token: 'tok-condo-7' } } : null;
            return where.id === 6 ? { id: 6, id_condominio: 7, tipo: 'lpr', ativo: 1 } : where.id === 5 ? { id: 5, id_condominio: 7, tipo: 'facial', ativo: 1 } : null;
          }),
        },
      };
      const svc = new FacialService(
        prisma, null as any, null as any, null as any, null as any,
        null as any, null as any, null as any, null as any, null as any,
      );
      const runWebhook = jest.spyOn(svc as any, 'runWebhook').mockResolvedValue({ ok: true });
      return { svc, runWebhook };
    }

    it('evento com token de dispositivo para OUTRO dispositivo: 401, sem runWebhook', async () => {
      const { svc, runWebhook } = build();
      await expect(svc.processAgentEvent('tok-5', 6, { placa: 'DUMMY1' } as any)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(runWebhook).not.toHaveBeenCalled();
    });

    it('evento do próprio dispositivo continua aceito', async () => {
      const { svc, runWebhook } = build();
      await svc.processAgentEvent('tok-5', 5, { external_id: 'm-1' } as any);
      expect(runWebhook).toHaveBeenCalled();
    });

    it('resolveAgente diz quando o condomínio do dispositivo não tem agent_token (nulo ou vazio)', async () => {
      const { svc } = build();
      await expect(svc.resolveAgente('tok-9')).resolves.toEqual({
        idCondominio: 8, viaTokenDispositivo: true, idDispositivo: 9, condominioSemAgentToken: true,
      });
      await expect(svc.resolveAgente('tok-vazio')).resolves.toMatchObject({ condominioSemAgentToken: true });
      const comAgentToken: any = await svc.resolveAgente('tok-5');
      expect(comAgentToken.condominioSemAgentToken).toBeFalsy();
    });

    it('resolveCondominioForAgent (escopo do condomínio) só aceita o agent_token', async () => {
      const { svc } = build();
      await expect(svc.resolveCondominioForAgent('tok-condo-7')).resolves.toBe(7);
      await expect(svc.resolveCondominioForAgent('tok-5')).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
