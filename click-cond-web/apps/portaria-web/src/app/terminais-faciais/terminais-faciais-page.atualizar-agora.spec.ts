import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { TerminaisFaciaisPageComponent } from './terminais-faciais-page.component';
import { TerminaisFaciaisApi } from './terminais-faciais.service';
import { AreasSociaisApi } from '../areas-sociais/areas-sociais.service';

/**
 * Card "Agente local": botão "Atualizar agora" (agente >= 2026.11.11.1), estado
 * da atualização em tempo real e o ritmo de reconsulta da saúde do agente
 * (3 s enquanto a atualização anda ou por 2 min depois do clique; 15 s no resto).
 */
const AGORA = new Date('2026-11-11T15:00:00.000Z');

const facial = {
  id: 7,
  nome: 'Portaria',
  tipo: 'facial',
  sentido: 'auto',
  fabricante: 'intelbras',
  modelo: null,
  ip: '192.168.3.10',
  porta: 80,
  api_user: 'admin',
  ativo: 1,
  agent_online: true,
  device_online: null,
} as any;

const saude = (extra: Record<string, unknown> = {}) => ({
  recebido_em: new Date().toISOString(),
  versao: '2026.11.11.1',
  so: 'win32',
  iniciado_em: '2026-11-11T12:00:00.000Z',
  dispositivos: [],
  eventos_pendentes: 0,
  versao_disponivel: '2026.11.12',
  atualizacao: null,
  ...extra,
});

const estado = (nome: string, extra: Record<string, unknown> = {}) => ({
  estado: nome,
  versao_alvo: '2026.11.12',
  erro: null,
  em: new Date().toISOString(),
  ...extra,
});

function build(extra: Record<string, unknown> = {}) {
  const api = {
    list: jest.fn(() => of([facial])),
    syncPessoas: jest.fn(() => of([])),
    syncStatus: jest.fn(() => of({ synced: 0, pending: 0, error: 0, semFoto: 0, running: false })),
    agentInfo: jest.fn(() => of({ agent_token: 't', download_url: null })),
    agentSaude: jest.fn(() => of(saude())),
    health: jest.fn(() => of({ terminais: { total: 1, offline: [], semReporteRecente: [] }, agente: { online: true, lastSeenAt: null }, fantasmas: { ultimaVarreduraEm: null, terminaisVarridos: 0, terminaisComFalha: [], removidosHoje: 0, eventosHoje: [] } })),
    descobertos: jest.fn(() => of({ recebido_em: null, achados: [], avisos: [] })),
    procurarDescobertos: jest.fn(() => of({ ok: true })),
    atualizarAgenteAgora: jest.fn(() => of({ ok: true, agente_online: true, suportado: true })),
    ...extra,
  };
  TestBed.configureTestingModule({
    imports: [TerminaisFaciaisPageComponent],
    providers: [
      { provide: TerminaisFaciaisApi, useValue: api },
      { provide: AreasSociaisApi, useValue: { listAreas: jest.fn(() => of([])) } },
    ],
  });
  const f = TestBed.createComponent(TerminaisFaciaisPageComponent);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const cardAgente = () => el.querySelector('#agente-local') as HTMLElement;
  const botao = () =>
    Array.from(cardAgente().querySelectorAll('button')).find((b) => b.textContent?.includes('Atualizar agora')) as
      | HTMLButtonElement
      | undefined;
  const q = (testid: string) => cardAgente().querySelector(`[data-testid="${testid}"]`) as HTMLElement | null;
  /** Avança o relógio e conta quantas vezes a saúde do agente foi reconsultada no período. */
  const consultasEm = (ms: number) => {
    api.agentSaude.mockClear();
    jest.advanceTimersByTime(ms);
    return api.agentSaude.mock.calls.length;
  };
  return { f, tela: f.componentInstance, api, el, botao, q, consultasEm };
}

/**
 * Mexer num signal agenda a detecção de mudanças do Angular (setTimeout +
 * requestAnimationFrame). Roda esses agendamentos — bem antes dos 3 s do timer
 * mais curto da tela — para a contagem de timers falar só dos da tela.
 */
const descarregarTimersDoAngular = () => jest.advanceTimersByTime(50);

describe('TerminaisFaciaisPageComponent — "Atualizar agora" no card do agente', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(AGORA);
  });
  afterEach(() => jest.useRealTimers());

  describe('quando o botão aparece', () => {
    it('há atualização disponível e o agente é 2026.11.11.1 ou mais novo', () => {
      const { tela, botao } = build();
      expect(botao()).toBeDefined();
      expect(botao()?.disabled).toBe(false);
      tela.ngOnDestroy();
    });

    it.each(['2026.11.11', '2026.9.30.7', '2026.09.25.1'])(
      'agente %s (anterior à 2026.11.11.1): sem botão, o texto do ciclo de 6 h continua',
      (versao) => {
        const { tela, botao, q } = build({ agentSaude: jest.fn(() => of(saude({ versao }))) });
        expect(botao()).toBeUndefined();
        expect(q('agente-atualizacao')?.textContent).toContain('O agente baixa e instala sozinho');
        tela.ngOnDestroy();
      },
    );

    it('sem atualização disponível não há botão', () => {
      const { tela, botao } = build({ agentSaude: jest.fn(() => of(saude({ versao_disponivel: null }))) });
      expect(botao()).toBeUndefined();
      tela.ngOnDestroy();
    });
  });

  describe('ao clicar', () => {
    it('desabilita enquanto a chamada está no ar, chama a rota e confirma o pedido', () => {
      const resposta = new Subject<{ ok: true; agente_online: boolean; suportado: boolean }>();
      const { f, tela, api, botao, q } = build({ atualizarAgenteAgora: jest.fn(() => resposta) });
      botao()?.click();
      f.detectChanges();
      expect(api.atualizarAgenteAgora).toHaveBeenCalledTimes(1);
      expect(botao()?.disabled).toBe(true);
      expect(q('agente-atualizar-agora-msg')).toBeNull();

      resposta.next({ ok: true, agente_online: true, suportado: true });
      resposta.complete();
      f.detectChanges();
      expect(botao()?.disabled).toBe(false);
      expect(q('agente-atualizar-agora-msg')?.textContent).toContain('Pedido enviado. O agente confere em instantes.');
      expect(q('agente-atualizar-agora-msg')?.getAttribute('role')).toBe('status');
      tela.ngOnDestroy();
    });

    it('agente desconectado: avisa que ele atualiza quando voltar', () => {
      const { f, tela, botao, q } = build({
        atualizarAgenteAgora: jest.fn(() => of({ ok: true, agente_online: false, suportado: true })),
      });
      botao()?.click();
      f.detectChanges();
      expect(q('agente-atualizar-agora-msg')?.textContent).toContain(
        'O agente não está conectado agora; ele atualiza assim que voltar.',
      );
      expect(q('agente-atualizar-agora-msg')?.textContent).not.toContain('Pedido enviado');
      tela.ngOnDestroy();
    });

    it('erro da API: mostra a mensagem dela com role="alert", reabilita e não acelera a reconsulta', () => {
      const { f, tela, botao, q, consultasEm } = build({
        atualizarAgenteAgora: jest.fn(() => throwError(() => ({ error: { message: 'Sem permissão para atualizar o agente.' } }))),
      });
      botao()?.click();
      f.detectChanges();
      const msg = q('agente-atualizar-agora-msg');
      expect(msg?.getAttribute('role')).toBe('alert');
      expect(msg?.textContent).toContain('Sem permissão para atualizar o agente.');
      expect(botao()?.disabled).toBe(false);
      expect(consultasEm(15_000)).toBe(1);
      tela.ngOnDestroy();
    });

    it('suportado=false (telemetria defasada): diz que esta versão não aceita o pedido, sem "Pedido enviado"', () => {
      const { f, tela, botao, q } = build({
        atualizarAgenteAgora: jest.fn(() => of({ ok: true, agente_online: true, suportado: false })),
      });
      botao()?.click();
      f.detectChanges();
      const msg = q('agente-atualizar-agora-msg');
      expect(msg?.textContent?.trim()).toBe(
        'Esta versão do agente ainda não aceita o pedido; ela se atualiza sozinha no próximo ciclo.',
      );
      expect(msg?.textContent).not.toContain('Pedido enviado');
      expect(msg?.getAttribute('role')).toBe('status');
      tela.ngOnDestroy();
    });

    it.each(['verificando', 'baixando', 'instalando'])(
      'estado %s em andamento: botão visível mas desabilitado; reabilita quando o estado sai de "em andamento"',
      (nome) => {
        let atual: Record<string, unknown> = saude({ atualizacao: estado(nome) });
        const { f, tela, api, botao } = build({ agentSaude: jest.fn(() => of(atual)) });
        expect(botao()).toBeDefined();
        expect(botao()?.disabled).toBe(true);
        expect(botao()?.getAttribute('aria-disabled')).toBe('true');
        botao()?.click();
        expect(api.atualizarAgenteAgora).not.toHaveBeenCalled();

        atual = saude({ atualizacao: estado('falhou', { erro: 'SHA-256 não confere' }) });
        jest.advanceTimersByTime(3_000);
        f.detectChanges();
        expect(botao()?.disabled).toBe(false);
        expect(botao()?.getAttribute('aria-disabled')).toBeNull();
        tela.ngOnDestroy();
      },
    );

    it('erro sem mensagem da API cai num texto próprio', () => {
      const { f, tela, botao, q } = build({ atualizarAgenteAgora: jest.fn(() => throwError(() => ({ status: 0 }))) });
      botao()?.click();
      f.detectChanges();
      expect(q('agente-atualizar-agora-msg')?.getAttribute('role')).toBe('alert');
      expect(q('agente-atualizar-agora-msg')?.textContent?.trim()).not.toBe('');
      tela.ngOnDestroy();
    });
  });

  describe('ritmo de reconsulta da saúde do agente', () => {
    it('sem nada em andamento, reconsulta a cada 15 s', () => {
      const { tela, consultasEm } = build();
      expect(consultasEm(14_999)).toBe(0);
      expect(consultasEm(1)).toBe(1);
      expect(consultasEm(60_000)).toBe(4);
      tela.ngOnDestroy();
    });

    it('depois do clique, reconsulta a cada 3 s por 2 minutos e volta ao ritmo normal', () => {
      const { tela, botao, consultasEm } = build();
      botao()?.click();
      expect(consultasEm(2_999)).toBe(0);
      expect(consultasEm(1)).toBe(1);
      expect(consultasEm(9_000)).toBe(3);
      // Leva o relógio para depois da janela de 2 min (contada do clique).
      jest.advanceTimersByTime(120_000);
      expect(consultasEm(15_000)).toBe(1);
      expect(consultasEm(30_000)).toBe(2);
      tela.ngOnDestroy();
    });

    it.each(['verificando', 'baixando', 'instalando'])(
      'estado %s na telemetria acelera sozinho (sem clique) e desacelera quando termina',
      (nome) => {
        let atual: Record<string, unknown> = saude({ atualizacao: estado(nome) });
        const { tela, consultasEm } = build({ agentSaude: jest.fn(() => of(atual)) });
        expect(consultasEm(9_000)).toBe(3);
        atual = saude({ atualizacao: estado('em_dia') });
        // O próximo tique rápido (3 s) lê "em_dia" e desliga o ritmo rápido.
        jest.advanceTimersByTime(3_000);
        // Alinha com o intervalo de 15 s (já se passaram 12 s desde a carga).
        jest.advanceTimersByTime(3_000);
        expect(consultasEm(15_000)).toBe(1);
        tela.ngOnDestroy();
      },
    );

    it('estado em andamento há mais de 10 min (agente travou) não acelera e mostra o texto padrão', () => {
      const velho = new Date(AGORA.getTime() - 11 * 60_000).toISOString();
      const { tela, q, consultasEm } = build({
        agentSaude: jest.fn(() => of(saude({ atualizacao: estado('baixando', { em: velho }) }))),
      });
      expect(q('agente-atualizacao')?.textContent).toContain('O agente baixa e instala sozinho');
      expect(consultasEm(15_000)).toBe(1);
      tela.ngOnDestroy();
    });

    it('estado em andamento com telemetria velha (agente morto, relógio do PC errado) não acelera e mostra o texto padrão', () => {
      const velha = new Date(AGORA.getTime() - 4 * 60_000).toISOString();
      const adiantado = new Date(AGORA.getTime() + 45 * 60_000).toISOString();
      const { tela, botao, q, consultasEm } = build({
        agentSaude: jest.fn(() => of(saude({ recebido_em: velha, atualizacao: estado('baixando', { em: adiantado }) }))),
      });
      expect(q('agente-atualizacao')?.textContent).toContain('O agente baixa e instala sozinho');
      expect(botao()?.disabled).toBe(false);
      expect(consultasEm(15_000)).toBe(1);
      tela.ngOnDestroy();
    });

    it('resposta do "Atualizar agora" que chega depois do ngOnDestroy não agenda nada', () => {
      const resposta = new Subject<{ ok: true; agente_online: boolean; suportado: boolean }>();
      const { tela, consultasEm } = build({ atualizarAgenteAgora: jest.fn(() => resposta) });
      tela.atualizarAgenteAgora();
      descarregarTimersDoAngular();
      tela.ngOnDestroy();
      expect(jest.getTimerCount()).toBe(0);

      resposta.next({ ok: true, agente_online: true, suportado: true });
      resposta.complete();
      descarregarTimersDoAngular();
      expect(jest.getTimerCount()).toBe(0);
      expect(consultasEm(60_000)).toBe(0);
    });

    it('telemetria que chega depois do ngOnDestroy não recria o intervalo rápido nem a confirmação', () => {
      const pendente = new Subject<Record<string, unknown>>();
      let resposta: any = of(saude());
      const { tela, consultasEm } = build({ agentSaude: jest.fn(() => resposta) });
      resposta = pendente;
      tela.loadAgentTelemetria();
      descarregarTimersDoAngular();
      tela.ngOnDestroy();
      expect(jest.getTimerCount()).toBe(0);

      // Em andamento (ligaria o ritmo de 3 s) e já na versão nova (ligaria o timer da confirmação).
      pendente.next(saude({ versao: '2026.11.12', atualizacao: estado('baixando', { versao_alvo: '2026.11.13' }) }));
      pendente.complete();
      descarregarTimersDoAngular();
      expect(jest.getTimerCount()).toBe(0);
      expect(tela.agenteAtualizadoMsg()).toBeNull();
      expect(consultasEm(60_000)).toBe(0);
    });

    it('falha da telemetria que chega depois do ngOnDestroy também não agenda nada', () => {
      const pendente = new Subject<Record<string, unknown>>();
      let resposta: any = of(saude());
      const { tela, botao } = build({ agentSaude: jest.fn(() => resposta) });
      botao()?.click();
      resposta = pendente;
      tela.loadAgentTelemetria();
      tela.ngOnDestroy();
      // O instante do pedido é zerado: nada mais mantém a janela de 2 min aberta.
      expect((tela as any).atualizacaoPedidaEm).toBeNull();

      pendente.error({ status: 0 });
      descarregarTimersDoAngular();
      expect(jest.getTimerCount()).toBe(0);
    });

    it('ngOnDestroy limpa os timers (nenhum vazando com o ritmo rápido ligado)', () => {
      const { tela, consultasEm } = build({ agentSaude: jest.fn(() => of(saude({ atualizacao: estado('baixando') }))) });
      tela.atualizarAgenteAgora();
      descarregarTimersDoAngular();
      // Sobram só os da tela: o intervalo de 15 s e o rápido de 3 s.
      expect(jest.getTimerCount()).toBe(2);
      tela.ngOnDestroy();
      expect(jest.getTimerCount()).toBe(0);
      expect(consultasEm(60_000)).toBe(0);
    });

    it('ngOnDestroy também limpa o timer da confirmação "Agente atualizado"', () => {
      let atual: Record<string, unknown> = saude();
      const { tela } = build({ agentSaude: jest.fn(() => of(atual)) });
      atual = saude({ versao: '2026.11.12', versao_disponivel: null });
      tela.loadAgentTelemetria();
      expect(tela.agenteAtualizadoMsg()).toBe('Agente atualizado para a versão 2026.11.12.');
      descarregarTimersDoAngular();
      // Sobram só os da tela: o intervalo de 15 s e o da confirmação.
      expect(jest.getTimerCount()).toBe(2);
      tela.ngOnDestroy();
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('estado em tempo real no card', () => {
    it.each([
      ['verificando', 'Conferindo se há versão nova…'],
      ['baixando', 'Baixando a versão 2026.11.12…'],
      ['instalando', 'Instalando a versão 2026.11.12. O agente reinicia sozinho em instantes.'],
    ])('%s: o texto do card reflete o estado, com role="status" e sem alerta', (nome, texto) => {
      const { tela, q } = build({ agentSaude: jest.fn(() => of(saude({ atualizacao: estado(nome) }))) });
      const p = q('agente-atualizacao');
      expect(p?.textContent?.trim()).toBe(texto);
      expect(p?.getAttribute('role')).toBe('status');
      expect(p?.className).not.toContain('rose');
      tela.ngOnDestroy();
    });

    it('falhou: texto com o erro, role="status" e destaque de alerta', () => {
      const { tela, q } = build({
        agentSaude: jest.fn(() => of(saude({ atualizacao: estado('falhou', { erro: 'SHA-256 não confere' }) }))),
      });
      const p = q('agente-atualizacao');
      expect(p?.textContent).toContain('A atualização para a versão 2026.11.12 falhou: SHA-256 não confere.');
      expect(p?.getAttribute('role')).toBe('status');
      expect(p?.className).toContain('text-rose-600');
      tela.ngOnDestroy();
    });

    it('indisponivel: manda usar "Reinstalar ou configurar"', () => {
      const { tela, q } = build({
        agentSaude: jest.fn(() => of(saude({ atualizacao: estado('indisponivel', { erro: 'executado fora do serviço' }) }))),
      });
      expect(q('agente-atualizacao')?.textContent).toContain(
        'Este agente não consegue se atualizar sozinho: executado fora do serviço. Use "Reinstalar ou configurar".',
      );
      tela.ngOnDestroy();
    });

    it('a versão instalada vira a disponível: confirma, some com o botão e volta ao ritmo normal', () => {
      let atual: Record<string, unknown> = saude();
      const { f, tela, botao, q, consultasEm } = build({ agentSaude: jest.fn(() => of(atual)) });
      botao()?.click();
      expect(q('agente-atualizado')).toBeNull();

      atual = saude({ versao: '2026.11.12', versao_disponivel: null, atualizacao: estado('em_dia', { versao_alvo: null }) });
      jest.advanceTimersByTime(3_000);
      f.detectChanges();
      const ok = q('agente-atualizado');
      expect(ok?.textContent).toContain('Agente atualizado para a versão 2026.11.12.');
      expect(ok?.getAttribute('role')).toBe('status');
      expect(q('agente-atualizar-agora-msg')).toBeNull();
      expect(botao()).toBeUndefined();

      // Ritmo normal mesmo dentro dos 2 min do clique: 12 s para alinhar com o de 15 s, depois 1 por 15 s.
      jest.advanceTimersByTime(12_000);
      expect(consultasEm(15_000)).toBe(1);

      // A confirmação é breve.
      f.detectChanges();
      expect(q('agente-atualizado')).toBeNull();
      tela.ngOnDestroy();
    });

    it('telemetria que já chega atualizada (sem ter visto a versão antiga) não inventa confirmação', () => {
      const { tela, q } = build({
        agentSaude: jest.fn(() => of(saude({ versao: '2026.11.12', versao_disponivel: null }))),
      });
      jest.advanceTimersByTime(30_000);
      expect(q('agente-atualizado')).toBeNull();
      tela.ngOnDestroy();
    });
  });
});
