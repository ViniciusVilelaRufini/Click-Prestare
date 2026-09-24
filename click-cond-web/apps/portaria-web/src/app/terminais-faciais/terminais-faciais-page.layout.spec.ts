import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { TerminaisFaciaisPageComponent } from './terminais-faciais-page.component';
import { FacialHealth, SyncPessoa, TerminaisFaciaisApi } from './terminais-faciais.service';
import { AreasSociaisApi } from '../areas-sociais/areas-sociais.service';

/**
 * Área "Agente Local + Sincronização de rostos":
 *  - a instalação do agente é contextual: aberta enquanto o agente não está
 *    conectado; conectado, recolhe (e pode ser reaberta);
 *  - "conectado" tem UMA fonte (saúde do facial), com os terminais de reserva;
 *  - os contadores filtram a lista de pessoas (ex.: só os erros, com o motivo).
 */
describe('TerminaisFaciaisPageComponent — agente e sincronização', () => {
  let ultimaFixture: any;
  const pessoas: SyncPessoa[] = [
    { tipo: 'visitante', categoria: 'visitante', id: 1, nome: 'QA_A', tem_foto: true, status: 'error', motivo: 'Bad Request', motivo_detalhado: 'Foto recusada pelo terminal.' },
    { tipo: 'morador', categoria: 'morador', id: 2, nome: 'QA_B', tem_foto: true, status: 'synced', motivo: '', motivo_detalhado: null },
    { tipo: 'morador', categoria: 'morador', id: 3, nome: 'QA_C', tem_foto: false, status: 'no_photo', motivo: '', motivo_detalhado: null },
  ];

  function build(apiOverrides: Record<string, unknown> = {}): TerminaisFaciaisPageComponent {
    TestBed.configureTestingModule({
      imports: [TerminaisFaciaisPageComponent],
      providers: [
        {
          provide: TerminaisFaciaisApi,
          useValue: {
            list: jest.fn(() => of([])),
            syncPessoas: jest.fn(() => of(pessoas)),
            syncMorador: jest.fn(() => of({ ok: true })),
            syncVisitante: jest.fn(() => of({ ok: true })),
            syncStatus: jest.fn(() => of({ synced: 0, pending: 0, error: 0, semFoto: 0, running: false })),
            agentInfo: jest.fn(() => of({ agent_token: 'teste', download_url: null })),
            agentSaude: jest.fn(() => of(null)),
            health: jest.fn(() => of({ terminais: { total: 0, offline: [], semReporteRecente: [] }, agente: { online: true, lastSeenAt: null }, fantasmas: { ultimaVarreduraEm: null, removidosHoje: 0, eventosHoje: [] } })),
            ...apiOverrides,
          },
        },
        { provide: AreasSociaisApi, useValue: { listAreas: jest.fn(() => of([])) } },
      ],
    });
    ultimaFixture = TestBed.createComponent(TerminaisFaciaisPageComponent);
    return ultimaFixture.componentInstance;
  }

  const saude = (online: boolean): FacialHealth => ({
    terminais: { total: 1, offline: [], semReporteRecente: [] },
    agente: { online, lastSeenAt: online ? new Date().toISOString() : null },
    fantasmas: { ultimaVarreduraEm: null, removidosHoje: 0, eventosHoje: [] },
  });

  it('agente sem conexão: instalação aberta', () => {
    const tela = build();
    tela.health.set(saude(false));
    expect(tela.agenteConectado()).toBe(false);
    expect(tela.instalacaoAberta()).toBe(true);
  });

  it('agente conectado: instalação recolhida, e pode ser reaberta', () => {
    const tela = build();
    tela.health.set(saude(true));
    expect(tela.instalacaoAberta()).toBe(false);
    tela.mostrarInstalacao.set(true);
    expect(tela.instalacaoAberta()).toBe(true);
  });

  it('sem saúde carregada, usa o status dos terminais', () => {
    const tela = build();
    tela.terminais.set([{ agent_online: true } as any]);
    expect(tela.agenteConectado()).toBe(true);
  });

  it('clicar em "Erros" abre a lista só com os erros', () => {
    const tela = build();
    tela.abrirPessoas('error');
    expect(tela.mostrarPessoas()).toBe(true);
    expect(tela.pessoasFiltradas().map((p) => p.nome)).toEqual(['QA_A']);
    tela.abrirPessoas(null);
    expect(tela.pessoasFiltradas()).toHaveLength(3);
  });

  it('expande e recolhe o motivo completo ao selecionar uma pessoa com erro', () => {
    const tela = build();
    const pessoaComErro = {
      ...pessoas[0],
      motivo_detalhado: 'O terminal recusou a foto porque nÃ£o encontrou um rosto vÃ¡lido.',
    } as any;

    tela.toggleDetalhePessoa(pessoaComErro);
    expect(tela.pessoaDetalhada()).toBe('visitante_1');

    tela.toggleDetalhePessoa(pessoaComErro);
    expect(tela.pessoaDetalhada()).toBeNull();
  });

  it('atalho de motivo abre o primeiro erro jÃ¡ expandido', () => {
    const tela = build();

    tela.verMotivoErro();

    expect(tela.mostrarPessoas()).toBe(true);
    expect(tela.filtroPessoas()).toBe('error');
    expect(tela.pessoaDetalhada()).toBe('visitante_1');
  });

  it('mantÃ©m o reenvio da pessoa bloqueado enquanto a solicitaÃ§Ã£o estÃ¡ em andamento', () => {
    const respostaReenvio = new Subject<unknown>();
    const tela = build({ syncVisitante: jest.fn(() => respostaReenvio) });

    tela.retryPessoa(pessoas[0]);
    expect(tela.retryingPessoa()).toBe('visitante_1');

    respostaReenvio.next({ ok: true });
    respostaReenvio.complete();
    expect(tela.retryingPessoa()).toBeNull();
  });

  it('clicar no selo de erro abre o detalhe do envio', () => {
    const tela = build();
    ultimaFixture.detectChanges();
    tela.syncStatus.set({
      synced: 0,
      pending: 0,
      error: 1,
      semFoto: 0,
      running: false,
    });
    tela.terminais.set([{ id: 1, nome: 'Terminal QA' } as any]);
    tela.pessoas.set([pessoas[0]]);
    tela.mostrarPessoas.set(true);
    tela.filtroPessoas.set('error');
    ultimaFixture.detectChanges();

    const seloErro = ultimaFixture.nativeElement.querySelector(
      'button[aria-label="Ver detalhe do erro"]',
    ) as HTMLButtonElement;
    seloErro.click();
    ultimaFixture.detectChanges();

    expect(tela.pessoaDetalhada()).toBe('visitante_1');
    expect(ultimaFixture.nativeElement.textContent).toContain('Detalhe do erro no envio');
  });
});
