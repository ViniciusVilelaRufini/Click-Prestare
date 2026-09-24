import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { FacialController } from './facial.controller';
import { AgentBridgeService } from './agent-bridge.service';

/**
 * Telemetria do Agente Local (tarefa 7):
 *  - POST condo/:token/telemetria (AgentController) resolve o condomínio
 *    pelo token, como as outras rotas condo/*, e guarda a última foto no
 *    AgentBridgeService;
 *  - GET facial/agent/saude (FacialController) devolve essa última foto +
 *    versao_disponivel (null até a tarefa 8) — só para operador, morador
 *    é recusado (mesmo tenant check de agent/info, com assertOperador a mais).
 */
describe('POST facial/agent/condo/:token/telemetria', () => {
  const payload = {
    versao: '2026.09.24',
    so: 'win32 10.0.26100',
    iniciado_em: '2026-09-23T00:00:00.000Z',
    dispositivos: [
      { id: 10, driver: 'dahua-facial', online: true, ultimo_evento_em: null, ultimo_erro: null },
    ],
    eventos_pendentes: 2,
  };

  it('token inválido: recusa como as outras rotas condo/*', async () => {
    const service: any = {
      resolveCondominioForAgent: jest.fn(async () => {
        throw new UnauthorizedException('Token do agente inválido');
      }),
    };
    const bridge = new AgentBridgeService();
    const ctrl = new AgentController(service, bridge);
    await expect(ctrl.condoTelemetria('token-invalido', payload as any)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('token válido: guarda a telemetria no bridge, sob o id do condomínio resolvido', async () => {
    const service: any = { resolveCondominioForAgent: jest.fn(async () => 7) };
    const bridge = new AgentBridgeService();
    const ctrl = new AgentController(service, bridge);

    const res = await ctrl.condoTelemetria('token-ok', payload as any);

    expect(res).toEqual({ ok: true });
    const guardada = bridge.getTelemetria(7);
    expect(guardada?.versao).toBe(payload.versao);
    expect(guardada?.so).toBe(payload.so);
    expect(guardada?.dispositivos).toEqual(payload.dispositivos);
    expect(guardada?.eventos_pendentes).toBe(2);
    expect(typeof guardada?.recebido_em).toBe('string');
  });
});

describe('GET facial/agent/saude', () => {
  const operador = { sub: 3, nome: 'QA porteiro', id_condominio: 7 } as any;
  // Morador de verdade (app) nunca carrega id_condominio no JWT — é o que faz
  // isOperador() recusar (mesmo padrão de dashboard.papel.spec.ts).
  const morador = { sub: 50, nome: 'QA morador', typeAccess: 'Morador' } as any;

  it('morador é recusado', () => {
    const bridge = new AgentBridgeService();
    const ctrl = new FacialController({} as any, bridge);
    expect(() => ctrl.agentSaude(7, morador)).toThrow(ForbiddenException);
  });

  it('operador lê a última telemetria + versao_disponivel null (tarefa 8 preenche)', () => {
    const bridge = new AgentBridgeService();
    bridge.setTelemetria(7, {
      versao: '2026.09.24',
      so: 'win32 10.0.26100',
      iniciado_em: '2026-09-23T00:00:00.000Z',
      dispositivos: [
        { id: 10, driver: 'dahua-facial', online: true, ultimo_evento_em: null, ultimo_erro: null },
      ],
      eventos_pendentes: 2,
    });
    const ctrl = new FacialController({} as any, bridge);

    const res = ctrl.agentSaude(7, operador);

    expect(res.versao).toBe('2026.09.24');
    expect(res.dispositivos).toHaveLength(1);
    expect(res.eventos_pendentes).toBe(2);
    expect(res.versao_disponivel).toBeNull();
    expect(typeof res.recebido_em).toBe('string');
  });

  it('sem telemetria ainda (agente nunca reportou): devolve vazio, não lança', () => {
    const bridge = new AgentBridgeService();
    const ctrl = new FacialController({} as any, bridge);

    const res = ctrl.agentSaude(7, operador);

    expect(res.recebido_em).toBeNull();
    expect(res.versao).toBeNull();
    expect(res.dispositivos).toEqual([]);
    expect(res.versao_disponivel).toBeNull();
  });

  it('condomínio de outro tenant é recusado (assertTenantStrict)', () => {
    const bridge = new AgentBridgeService();
    const ctrl = new FacialController({} as any, bridge);
    const operadorDeOutroCondominio = { sub: 3, nome: 'QA porteiro', id_condominio: 99 } as any;
    expect(() => ctrl.agentSaude(7, operadorDeOutroCondominio)).toThrow(ForbiddenException);
  });
});
