import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { TerminaisFaciaisPageComponent } from './terminais-faciais-page.component';
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
      { id: 10, driver: 'hikvision-facial', online: true, ultimo_evento_em: null, ultimo_erro: null },
      { id: 20, driver: 'control_id-facial', online: false, ultimo_erro: 'timeout ao reconectar', ultimo_evento_em: null },
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
