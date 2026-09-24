import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { FacialController } from './facial.controller';
import { AgentBridgeService, sanitizarTelemetria } from './agent-bridge.service';

/**
 * Telemetria do Agente Local (tarefa 7):
 *  - POST condo/:token/telemetria (AgentController) resolve o condomínio
 *    pelo token, como as outras rotas condo/*, e guarda a última foto no
 *    AgentBridgeService;
 *  - GET facial/agent/saude (FacialController) devolve essa última foto +
 *    versao_disponivel (tarefa 8: comparada contra AgentVersionService) —
 *    só para operador, morador é recusado (mesmo tenant check de agent/info,
 *    com assertOperador a mais).
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

  function agentVersionFake(info: { versao: string | null; url?: string | null; sha256?: string | null }) {
    return { getLatest: jest.fn(async () => ({ url: null, sha256: null, ...info })) };
  }

  it('morador é recusado', async () => {
    const bridge = new AgentBridgeService();
    const ctrl = new FacialController({} as any, bridge, agentVersionFake({ versao: null }) as any);
    await expect(ctrl.agentSaude(7, morador)).rejects.toThrow(ForbiddenException);
  });

  it('operador lê a última telemetria; sem versão nova publicada, versao_disponivel é null', async () => {
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
    const ctrl = new FacialController({} as any, bridge, agentVersionFake({ versao: '2026.09.24' }) as any);

    const res = await ctrl.agentSaude(7, operador);

    expect(res.versao).toBe('2026.09.24');
    expect(res.dispositivos).toHaveLength(1);
    expect(res.eventos_pendentes).toBe(2);
    expect(res.versao_disponivel).toBeNull();
    expect(typeof res.recebido_em).toBe('string');
  });

  it('versão publicada mais nova que a do agente: versao_disponivel vem preenchida', async () => {
    const bridge = new AgentBridgeService();
    bridge.setTelemetria(7, {
      versao: '2026.09.24',
      so: 'win32 10.0.26100',
      iniciado_em: '2026-09-23T00:00:00.000Z',
      dispositivos: [],
      eventos_pendentes: 0,
    });
    const ctrl = new FacialController({} as any, bridge, agentVersionFake({ versao: '2026.09.25' }) as any);

    const res = await ctrl.agentSaude(7, operador);

    expect(res.versao).toBe('2026.09.24');
    expect(res.versao_disponivel).toBe('2026.09.25');
  });

  it('versão publicada mais velha (ou igual) que a do agente: versao_disponivel continua null', async () => {
    const bridge = new AgentBridgeService();
    bridge.setTelemetria(7, {
      versao: '2026.09.24',
      so: 'x',
      iniciado_em: 'x',
      dispositivos: [],
      eventos_pendentes: 0,
    });
    const ctrl = new FacialController({} as any, bridge, agentVersionFake({ versao: '2026.09.20' }) as any);

    const res = await ctrl.agentSaude(7, operador);
    expect(res.versao_disponivel).toBeNull();
  });

  it('sem telemetria ainda (agente nunca reportou): devolve vazio, não lança, não compara versão', async () => {
    const bridge = new AgentBridgeService();
    const fakeVersion = agentVersionFake({ versao: '2026.09.25' });
    const ctrl = new FacialController({} as any, bridge, fakeVersion as any);

    const res = await ctrl.agentSaude(7, operador);

    expect(res.recebido_em).toBeNull();
    expect(res.versao).toBeNull();
    expect(res.dispositivos).toEqual([]);
    // Sem versão atual conhecida, não dá pra dizer que há "atualização
    // disponível" — mesmo a última publicada sendo mais nova que qualquer
    // coisa, não há base de comparação confiável.
    expect(res.versao_disponivel).toBeNull();
  });

  it('condomínio de outro tenant é recusado (assertTenantStrict)', async () => {
    const bridge = new AgentBridgeService();
    const ctrl = new FacialController({} as any, bridge, agentVersionFake({ versao: null }) as any);
    const operadorDeOutroCondominio = { sub: 3, nome: 'QA porteiro', id_condominio: 99 } as any;
    await expect(ctrl.agentSaude(7, operadorDeOutroCondominio)).rejects.toThrow(ForbiddenException);
  });
});

/**
 * A rota condo/:token/telemetria é @Public() (token do device, sem JWT) e
 * @SkipThrottle(), sob o limite genérico de body (50MB) — `AgentTelemetriaPayload`
 * é só um tipo do TypeScript, apagado em runtime. `sanitizarTelemetria()` é o
 * único ponto que decide o que entra no Map do AgentBridgeService: monta um
 * objeto NOVO só com os campos esperados, no tipo/tamanho certos, e nunca lança.
 */
describe('sanitizarTelemetria()', () => {
  it('payload válido passa praticamente inalterado', () => {
    const out = sanitizarTelemetria({
      versao: '2026.09.24',
      so: 'win32 10.0.26100',
      iniciado_em: '2026-09-23T00:00:00.000Z',
      dispositivos: [
        { id: 10, driver: 'dahua-facial', online: true, ultimo_evento_em: null, ultimo_erro: 'timeout' },
      ],
      eventos_pendentes: 5,
    });
    expect(out).toEqual({
      versao: '2026.09.24',
      so: 'win32 10.0.26100',
      iniciado_em: '2026-09-23T00:00:00.000Z',
      dispositivos: [
        { id: 10, driver: 'dahua-facial', online: true, ultimo_evento_em: null, ultimo_erro: 'timeout' },
      ],
      eventos_pendentes: 5,
    });
  });

  it('trunca strings grandes (versao, so, iniciado_em, ultimo_erro)', () => {
    const out = sanitizarTelemetria({
      versao: 'v'.repeat(1000),
      so: 's'.repeat(1000),
      iniciado_em: 'i'.repeat(1000),
      dispositivos: [{ id: 1, ultimo_erro: 'e'.repeat(1000) }],
      eventos_pendentes: 0,
    });
    expect(out.versao).toHaveLength(32);
    expect(out.so).toHaveLength(100);
    expect(out.iniciado_em).toHaveLength(40);
    expect(out.dispositivos[0].ultimo_erro).toHaveLength(500);
  });

  it('limita a lista de dispositivos a 200 entradas', () => {
    const dispositivos = Array.from({ length: 500 }, (_, i) => ({ id: i, online: true }));
    const out = sanitizarTelemetria({
      versao: 'x',
      so: 'x',
      iniciado_em: 'x',
      dispositivos,
      eventos_pendentes: 0,
    });
    expect(out.dispositivos).toHaveLength(200);
    expect(out.dispositivos[0].id).toBe(0);
  });

  it('tipos errados nos campos de topo viram default seguro, sem lançar', () => {
    const out = sanitizarTelemetria({
      versao: 12345,
      so: null,
      iniciado_em: { foo: 'bar' },
      dispositivos: 'nao é um array',
      eventos_pendentes: 'muitos',
    });
    expect(out).toEqual({
      versao: '',
      so: '',
      iniciado_em: '',
      dispositivos: [],
      eventos_pendentes: 0,
    });
  });

  it('eventos_pendentes negativo ou NaN vira 0', () => {
    expect(sanitizarTelemetria({ eventos_pendentes: -5 }).eventos_pendentes).toBe(0);
    expect(sanitizarTelemetria({ eventos_pendentes: NaN }).eventos_pendentes).toBe(0);
    expect(sanitizarTelemetria({ eventos_pendentes: Infinity }).eventos_pendentes).toBe(0);
  });

  it('device sem id numérico é descartado; campos extras do device são descartados', () => {
    const out = sanitizarTelemetria({
      dispositivos: [
        { id: 'nao-numero', driver: 'x', online: true },
        { driver: 'sem-id', online: true },
        { id: 2, driver: 'ok', online: true, campoInventado: 'deveria sumir' },
      ],
    });
    expect(out.dispositivos).toEqual([
      { id: 2, driver: 'ok', online: true, ultimo_evento_em: null, ultimo_erro: null },
    ]);
    expect((out.dispositivos[0] as any).campoInventado).toBeUndefined();
  });

  it('online só é true quando o valor é exatamente booleano true', () => {
    const out = sanitizarTelemetria({
      dispositivos: [
        { id: 1, online: 'true' },
        { id: 2, online: 1 },
        { id: 3, online: false },
      ],
    });
    expect(out.dispositivos.map((d) => d.online)).toEqual([false, false, false]);
  });

  it('campos extras no corpo (nível topo) são descartados', () => {
    const out = sanitizarTelemetria({
      versao: '1.0',
      so: 'x',
      iniciado_em: 'x',
      dispositivos: [],
      eventos_pendentes: 0,
      comando_secreto: 'rm -rf /',
    } as any);
    expect((out as any).comando_secreto).toBeUndefined();
    expect(Object.keys(out).sort()).toEqual(
      ['dispositivos', 'eventos_pendentes', 'iniciado_em', 'so', 'versao'].sort(),
    );
  });

  it('raw não-objeto (null, string, array, undefined) devolve os defaults, sem lançar', () => {
    for (const raw of [null, undefined, 'string qualquer', 42, []]) {
      expect(sanitizarTelemetria(raw)).toEqual({
        versao: '',
        so: '',
        iniciado_em: '',
        dispositivos: [],
        eventos_pendentes: 0,
      });
    }
  });
});
