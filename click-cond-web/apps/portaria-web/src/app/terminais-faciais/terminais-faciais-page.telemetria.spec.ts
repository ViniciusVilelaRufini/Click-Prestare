import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import {
  TELEMETRIA_VALIDA_MS,
  TerminaisFaciaisPageComponent,
  compararVersoesAgente,
} from './terminais-faciais-page.component';
import { AgentTelemetria, TerminaisFaciaisApi } from './terminais-faciais.service';
import { AreasSociaisApi } from '../areas-sociais/areas-sociais.service';

/**
 * Card do agente (tarefa 7): versão, "Atualização disponível" quando
 * versao_disponivel > versao, e a saúde por aparelho (driver, online, último
 * erro) casando o device do portal com o `id` que a telemetria reporta.
 */
describe('TerminaisFaciaisPageComponent — telemetria do agente', () => {
  function build(apiOverrides: Record<string, unknown> = {}): TerminaisFaciaisPageComponent {
    TestBed.configureTestingModule({
      imports: [TerminaisFaciaisPageComponent],
      providers: [
        {
          provide: TerminaisFaciaisApi,
          useValue: {
            syncPessoas: jest.fn(() => of([])),
            syncStatus: jest.fn(() => of({ synced: 0, pending: 0, error: 0, semFoto: 0, running: false })),
            descobertos: jest.fn(() => of({ recebido_em: null, achados: [], avisos: [] })),
            procurarDescobertos: jest.fn(() => of({ ok: true })),
            ...apiOverrides,
          },
        },
        { provide: AreasSociaisApi, useValue: {} },
      ],
    });
    return TestBed.createComponent(TerminaisFaciaisPageComponent).componentInstance;
  }

  const telemetria = (over: Partial<AgentTelemetria> = {}): AgentTelemetria => ({
    recebido_em: new Date().toISOString(),
    versao: '2026.09.24',
    so: 'win32 10.0.26100',
    iniciado_em: new Date().toISOString(),
    dispositivos: [
      { id: 10, driver: 'hikvision-facial', online: true, ouvinte_ativo: true, ultimo_evento_em: null, ultimo_erro: null },
      { id: 20, driver: 'control_id-facial', online: false, ouvinte_ativo: true, ultimo_erro: 'timeout ao reconectar', ultimo_evento_em: null },
    ],
    eventos_pendentes: 3,
    versao_disponivel: null,
    ...over,
  });

  it('loadAgentTelemetria(): guarda a última telemetria no signal', () => {
    const tela = build({ agentSaude: jest.fn(() => of(telemetria())) });
    tela.loadAgentTelemetria();
    expect(tela.agentTelemetria()?.versao).toBe('2026.09.24');
    expect(tela.agentTelemetria()?.eventos_pendentes).toBe(3);
  });

  it('telemetriaDoDispositivo(): casa por id e devolve driver/online/último erro', () => {
    const tela = build({ agentSaude: jest.fn(() => of(telemetria())) });
    tela.loadAgentTelemetria();

    const t10 = tela.telemetriaDoDispositivo(10);
    expect(t10?.driver).toBe('hikvision-facial');
    expect(t10?.online).toBe(true);
    expect(t10?.ultimo_erro).toBeNull();

    const t20 = tela.telemetriaDoDispositivo(20);
    expect(t20?.online).toBe(false);
    expect(t20?.ultimo_erro).toBe('timeout ao reconectar');
  });

  it('telemetriaDoDispositivo(): device sem telemetria (id não reportado) devolve null', () => {
    const tela = build({ agentSaude: jest.fn(() => of(telemetria())) });
    tela.loadAgentTelemetria();
    expect(tela.telemetriaDoDispositivo(999)).toBeNull();
  });

  it('telemetriaDoDispositivo(): sem telemetria carregada ainda, devolve null (não lança)', () => {
    const tela = build();
    expect(tela.telemetriaDoDispositivo(10)).toBeNull();
  });

  it('atualizacaoDisponivel(): true quando versao_disponivel > versao', () => {
    const tela = build({
      agentSaude: jest.fn(() => of(telemetria({ versao: '2026.09.24', versao_disponivel: '2026.10.01' }))),
    });
    tela.loadAgentTelemetria();
    expect(tela.atualizacaoDisponivel()).toBe(true);
  });

  it('atualizacaoDisponivel(): compara NUMERICAMENTE por segmento, não como string', () => {
    // Como string, "2026.09.9" > "2026.09.10" e o selo apareceria para uma
    // versão MAIS VELHA — e sumiria para a mais nova.
    const maisNova = build({
      agentSaude: jest.fn(() => of(telemetria({ versao: '2026.09.9', versao_disponivel: '2026.09.10' }))),
    });
    maisNova.loadAgentTelemetria();
    expect(maisNova.atualizacaoDisponivel()).toBe(true);

    TestBed.resetTestingModule();
    const maisVelha = build({
      agentSaude: jest.fn(() => of(telemetria({ versao: '2026.09.10', versao_disponivel: '2026.09.9' }))),
    });
    maisVelha.loadAgentTelemetria();
    expect(maisVelha.atualizacaoDisponivel()).toBe(false);

    TestBed.resetTestingModule();
    const mesmaComSufixo = build({
      agentSaude: jest.fn(() => of(telemetria({ versao: '2026.09.24', versao_disponivel: '2026.09.24.0' }))),
    });
    mesmaComSufixo.loadAgentTelemetria();
    expect(mesmaComSufixo.atualizacaoDisponivel()).toBe(false);
  });

  it('compararVersoesAgente(): mesmo contrato do agente (>0, <0, 0)', () => {
    expect(compararVersoesAgente('2026.10.01', '2026.09.30')).toBe(1);
    expect(compararVersoesAgente('2026.09.24', '2026.09.24.1')).toBe(-1);
    expect(compararVersoesAgente('2026.09.24', '2026.09.24.0')).toBe(0);
  });

  it('telemetriaDoDispositivo(): telemetria com mais de 3 min é ignorada (selos somem em vez de mentir)', () => {
    const velha = new Date(Date.now() - TELEMETRIA_VALIDA_MS - 1000).toISOString();
    const tela = build({ agentSaude: jest.fn(() => of(telemetria({ recebido_em: velha }))) });
    tela.loadAgentTelemetria();
    expect(tela.telemetriaRecente()).toBe(false);
    expect(tela.telemetriaDoDispositivo(10)).toBeNull();
  });

  it('telemetriaDoDispositivo(): telemetria recente (< 3 min) continua valendo', () => {
    const recente = new Date(Date.now() - 60 * 1000).toISOString();
    const tela = build({ agentSaude: jest.fn(() => of(telemetria({ recebido_em: recente }))) });
    tela.loadAgentTelemetria();
    expect(tela.telemetriaRecente()).toBe(true);
    expect(tela.telemetriaDoDispositivo(10)?.online).toBe(true);
  });

  it('atualizacaoDisponivel(): false quando já está na versão mais nova', () => {
    const tela = build({
      agentSaude: jest.fn(() => of(telemetria({ versao: '2026.09.24', versao_disponivel: '2026.09.24' }))),
    });
    tela.loadAgentTelemetria();
    expect(tela.atualizacaoDisponivel()).toBe(false);
  });

  it('atualizacaoDisponivel(): false quando versao_disponivel é null (tarefa 8 ainda não preencheu)', () => {
    const tela = build({ agentSaude: jest.fn(() => of(telemetria({ versao_disponivel: null }))) });
    tela.loadAgentTelemetria();
    expect(tela.atualizacaoDisponivel()).toBe(false);
  });

  it('sem telemetria carregada, atualizacaoDisponivel() é false (não lança)', () => {
    const tela = build();
    expect(tela.atualizacaoDisponivel()).toBe(false);
  });
});
