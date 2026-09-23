import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
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
  const pessoas: SyncPessoa[] = [
    { tipo: 'visitante', categoria: 'visitante', id: 1, nome: 'QA_A', tem_foto: true, status: 'error', motivo: 'Bad Request' },
    { tipo: 'morador', categoria: 'morador', id: 2, nome: 'QA_B', tem_foto: true, status: 'synced', motivo: '' },
    { tipo: 'morador', categoria: 'morador', id: 3, nome: 'QA_C', tem_foto: false, status: 'no_photo', motivo: '' },
  ];

  function build(): TerminaisFaciaisPageComponent {
    TestBed.configureTestingModule({
      imports: [TerminaisFaciaisPageComponent],
      providers: [
        { provide: TerminaisFaciaisApi, useValue: { syncPessoas: jest.fn(() => of(pessoas)) } },
        { provide: AreasSociaisApi, useValue: {} },
      ],
    });
    return TestBed.createComponent(TerminaisFaciaisPageComponent).componentInstance;
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
});
