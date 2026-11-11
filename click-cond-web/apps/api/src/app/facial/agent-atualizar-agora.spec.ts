import { ForbiddenException } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { FacialController } from './facial.controller';
import { AgentBridgeService, sanitizarTelemetria } from './agent-bridge.service';
import { AgentVersionService } from './agent-version.service';
import { DescobertaService } from './descoberta.service';

/**
 * "Atualizar agora" + estado da atualização do Agente Local:
 *  - POST facial/agent/atualizar-agora (portal, só operador do condomínio)
 *    registra um pedido de verificação de atualização — guardado no estado
 *    compartilhado, como o pedido de descoberta, com validade de 2 minutos;
 *  - GET condo/:token/poll entrega `verificar_atualizacao: true` UMA vez por
 *    pedido;
 *  - a telemetria passa a poder trazer `atualizacao` (estado/versão alvo/erro),
 *    sanitizada e devolvida por GET facial/agent/saude.
 */
const telemetriaBase = {
  versao: '2026.11.11.1',
  so: 'win32 10.0.26100',
  iniciado_em: '2026-11-11T12:00:00.000Z',
  dispositivos: [],
  eventos_pendentes: 0,
};

const operador = { sub: 3, nome: 'QA porteiro', id_condominio: 7 } as any;
// Morador de verdade (app) nunca carrega id_condominio no JWT.
const morador = { sub: 50, nome: 'QA morador', typeAccess: 'Morador' } as any;

function montarAgente(bridge = new AgentBridgeService()) {
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
  const ctrl = new AgentController(service, bridge, {} as AgentVersionService, descoberta);
  return { ctrl, bridge };
}

function montarPortal(bridge = new AgentBridgeService(), devices: { id: number }[] = [{ id: 10 }]) {
  const service: any = { getActiveDevices: jest.fn(async () => devices) };
  const ctrl = new FacialController(
    service,
    bridge,
    { getLatest: jest.fn(async () => ({ versao: null, url: null, sha256: null })) } as unknown as AgentVersionService,
    {} as DescobertaService,
  );
  return { ctrl, bridge, service };
}

describe('pedido de verificação de atualização (estado compartilhado)', () => {
  afterEach(() => jest.useRealTimers());

  it('é entregue uma única vez', async () => {
    const bridge = new AgentBridgeService();
    expect(await bridge.consumirPedidoDeAtualizacao(7)).toBe(false);
    await bridge.pedirVerificacaoDeAtualizacao(7);
    expect(await bridge.consumirPedidoDeAtualizacao(7)).toBe(true);
    expect(await bridge.consumirPedidoDeAtualizacao(7)).toBe(false);
  });

  it('vale 2 minutos: depois disso o agente não recebe mais', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-11T12:00:00.000Z'));
    const bridge = new AgentBridgeService();
    await bridge.pedirVerificacaoDeAtualizacao(7);
    jest.setSystemTime(new Date('2026-11-11T12:01:59.000Z'));
    await bridge.pedirVerificacaoDeAtualizacao(8);
    expect(await bridge.consumirPedidoDeAtualizacao(8)).toBe(true);
    jest.setSystemTime(new Date('2026-11-11T12:02:01.000Z'));
    expect(await bridge.consumirPedidoDeAtualizacao(7)).toBe(false);
  });

  it('com banco, grava na tabela estado_compartilhado (vale entre instâncias) com prazo de 2 min', async () => {
    const upsert = jest.fn(async () => ({}));
    const estado_Compartilhado = {
      upsert,
      findUnique: jest.fn(async () => null),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    };
    // Sem `isConnected`/tabelas do agente: o bridge fica em memória, mas o estado compartilhado usa o banco.
    const bridge = new AgentBridgeService({ estado_Compartilhado } as any);
    try {
      const antes = Date.now();
      await bridge.pedirVerificacaoDeAtualizacao(7);
      expect(upsert).toHaveBeenCalledTimes(1);
      const arg = (upsert.mock.calls[0] as any[])[0];
      expect(arg.where).toEqual({ chave: 'agente:pedido-atualizacao:7' });
      const prazoMs = new Date(arg.create.expira_em).getTime() - antes;
      expect(prazoMs).toBeGreaterThanOrEqual(2 * 60 * 1000 - 50);
      expect(prazoMs).toBeLessThanOrEqual(2 * 60 * 1000 + 5000);
    } finally {
      bridge.onModuleDestroy();
    }
  });
});

describe('GET facial/agent/condo/:token/poll — verificar_atualizacao', () => {
  it('false sem pedido; true exatamente uma vez depois do pedido', async () => {
    const { ctrl, bridge } = montarAgente();
    expect((await ctrl.condoPoll('token-ok')).verificar_atualizacao).toBe(false);
    await bridge.pedirVerificacaoDeAtualizacao(7);
    expect((await ctrl.condoPoll('token-ok')).verificar_atualizacao).toBe(true);
    expect((await ctrl.condoPoll('token-ok')).verificar_atualizacao).toBe(false);
  });

  it('pedido de outro condomínio não vaza para este token', async () => {
    const { ctrl, bridge } = montarAgente();
    await bridge.pedirVerificacaoDeAtualizacao(8);
    expect((await ctrl.condoPoll('token-ok')).verificar_atualizacao).toBe(false);
  });

  it('não interfere no pedido de descoberta', async () => {
    const { ctrl, bridge } = montarAgente();
    await bridge.pedirVerificacaoDeAtualizacao(7);
    const r = await ctrl.condoPoll('token-ok');
    expect(r.descobrir).toBe(false);
    expect(r.verificar_atualizacao).toBe(true);
  });
});

describe('POST facial/agent/atualizar-agora', () => {
  it('morador e operador de outro condomínio são recusados, sem registrar pedido', async () => {
    const { ctrl, bridge } = montarPortal();
    await expect(ctrl.atualizarAgenteAgora(7, morador)).rejects.toThrow(ForbiddenException);
    await expect(ctrl.atualizarAgenteAgora(7, { ...operador, id_condominio: 99 })).rejects.toThrow(ForbiddenException);
    expect(await bridge.consumirPedidoDeAtualizacao(7)).toBe(false);
  });

  it('registra o pedido do condomínio; agente online e versão que entende o pedido', async () => {
    const { ctrl, bridge } = montarPortal();
    await bridge.setTelemetria(7, telemetriaBase);
    bridge.heartbeat(10);
    await expect(ctrl.atualizarAgenteAgora(7, operador)).resolves.toEqual({ ok: true, agente_online: true, suportado: true });
    expect(await bridge.consumirPedidoDeAtualizacao(7)).toBe(true);
  });

  it('agente sem poll recente: agente_online false (o pedido fica registrado assim mesmo)', async () => {
    const { ctrl, bridge } = montarPortal();
    await bridge.setTelemetria(7, telemetriaBase);
    await expect(ctrl.atualizarAgenteAgora(7, operador)).resolves.toEqual({ ok: true, agente_online: false, suportado: true });
    expect(await bridge.consumirPedidoDeAtualizacao(7)).toBe(true);
  });

  it.each([
    ['2026.11.11', false],
    ['2026.9.30.5', false],
    ['2026.11.11.1', true],
    ['2026.11.11.2', true],
    ['2026.11.12', true],
    ['2026.12.1', true],
  ])('versão %s do agente: suportado = %s (comparação numérica)', async (versao, suportado) => {
    const { ctrl, bridge } = montarPortal();
    await bridge.setTelemetria(7, { ...telemetriaBase, versao });
    expect((await ctrl.atualizarAgenteAgora(7, operador)).suportado).toBe(suportado);
  });

  it('agente que nunca mandou telemetria: suportado false', async () => {
    const { ctrl } = montarPortal();
    await expect(ctrl.atualizarAgenteAgora(7, operador)).resolves.toEqual({ ok: true, agente_online: false, suportado: false });
  });
});

describe('sanitizarTelemetria() — atualizacao', () => {
  const em = '2026-11-11T12:34:56.000Z';

  it('agente antigo (sem o campo): o objeto continua sem a chave', () => {
    expect('atualizacao' in sanitizarTelemetria(telemetriaBase)).toBe(false);
  });

  it.each(['ocioso', 'verificando', 'em_dia', 'baixando', 'instalando', 'falhou', 'indisponivel'])(
    'estado %s é aceito',
    (estado) => {
      const out = sanitizarTelemetria({ ...telemetriaBase, atualizacao: { estado, versao_alvo: '2026.11.12', erro: null, em } });
      expect(out.atualizacao).toEqual({ estado, versao_alvo: '2026.11.12', erro: null, em });
    },
  );

  it.each([['explodindo'], [''], [null], [7], [{ a: 1 }], ['toString'], ['__proto__']])(
    'estado fora da lista (%p) descarta o objeto inteiro',
    (estado) => {
      const out = sanitizarTelemetria({ ...telemetriaBase, atualizacao: { estado, versao_alvo: '2026.11.12', erro: 'x', em } });
      expect('atualizacao' in out).toBe(false);
    },
  );

  it.each([[null], ['baixando'], [42], [[]], [['baixando']]])('atualizacao que não é objeto (%p) é descartada', (v) => {
    expect('atualizacao' in sanitizarTelemetria({ ...telemetriaBase, atualizacao: v })).toBe(false);
  });

  it('trunca as strings (erro em 200) e descarta campos a mais', () => {
    const out = sanitizarTelemetria({
      ...telemetriaBase,
      atualizacao: {
        estado: 'falhou',
        versao_alvo: 'v'.repeat(1000),
        erro: 'e'.repeat(1000),
        em: 'i'.repeat(1000),
        comando: 'rm -rf /',
        aninhado: { a: { b: 1 } },
      },
    });
    expect(out.atualizacao?.erro).toHaveLength(200);
    expect(out.atualizacao?.versao_alvo).toHaveLength(32);
    expect(out.atualizacao?.em).toHaveLength(40);
    expect(Object.keys(out.atualizacao ?? {}).sort()).toEqual(['em', 'erro', 'estado', 'versao_alvo']);
  });

  it('tipos errados dentro do objeto viram null/vazio, nunca passam como vieram', () => {
    const out = sanitizarTelemetria({
      ...telemetriaBase,
      atualizacao: { estado: 'baixando', versao_alvo: { x: 1 }, erro: ['a'], em: 12345 },
    });
    expect(out.atualizacao).toEqual({ estado: 'baixando', versao_alvo: null, erro: null, em: '' });
  });
});

describe('GET facial/agent/saude — atualizacao', () => {
  it('devolve o estado sanitizado que o agente mandou', async () => {
    const { ctrl, bridge } = montarPortal();
    const atualizacao = { estado: 'baixando', versao_alvo: '2026.11.12', erro: null, em: '2026-11-11T12:34:56.000Z' };
    await bridge.setTelemetria(7, { ...telemetriaBase, atualizacao, lixo: true });
    expect((await ctrl.agentSaude(7, operador)).atualizacao).toEqual(atualizacao);
  });

  it('agente antigo (não manda) e agente que nunca reportou: atualizacao null', async () => {
    const { ctrl, bridge } = montarPortal();
    expect((await ctrl.agentSaude(7, operador)).atualizacao).toBeNull();
    await bridge.setTelemetria(7, telemetriaBase);
    expect((await ctrl.agentSaude(7, operador)).atualizacao).toBeNull();
  });
});
