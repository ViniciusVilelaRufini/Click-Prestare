import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { TerminaisFaciaisPageComponent } from './terminais-faciais-page.component';
import { TerminaisFaciaisApi } from './terminais-faciais.service';
import { AreasSociaisApi } from '../areas-sociais/areas-sociais.service';

/**
 * Terminal com histórico de acessos não pode ser excluído (a API devolve 409 e
 * manda desativar). O portal precisa oferecer Desativar/Reativar — antes não
 * havia nenhum jeito de seguir a instrução da mensagem.
 */
describe('TerminaisFaciaisPageComponent — desativar terminal', () => {
  const terminal = { id: 1, nome: 'facial principal', tipo: 'facial', ativo: 1 } as any;

  function build(extra: Record<string, unknown> = {}) {
    const api = {
      list: jest.fn(() => of([])),
      syncPessoas: jest.fn(() => of([])),
      syncStatus: jest.fn(() => of({ synced: 0, pending: 0, error: 0, semFoto: 0, running: false })),
      agentInfo: jest.fn(() => of({ agent_token: 't', download_url: null })),
      agentSaude: jest.fn(() => of(null)),
      health: jest.fn(() => of({ terminais: { total: 0, offline: [], semReporteRecente: [] }, agente: { online: true, lastSeenAt: null }, fantasmas: { ultimaVarreduraEm: null, removidosHoje: 0, eventosHoje: [] } })),
      descobertos: jest.fn(() => of({ recebido_em: null, achados: [], avisos: [] })),
      procurarDescobertos: jest.fn(() => of({ ok: true })),
      update: jest.fn(() => of({ ...terminal, ativo: 0 })),
      remove: jest.fn(() => throwError(() => ({ status: 409, error: { message: 'x' } }))),
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
    return { tela: f.componentInstance, api };
  }

  beforeEach(() => jest.spyOn(window, 'confirm').mockReturnValue(true));
  afterEach(() => jest.restoreAllMocks());

  it('Desativar manda ativo: 0 e Reativar manda ativo: 1', () => {
    const { tela, api } = build();
    tela.alternarAtivo(terminal);
    expect(api.update).toHaveBeenCalledWith(1, { ativo: 0 });
    tela.alternarAtivo({ ...terminal, ativo: 0 });
    expect(api.update).toHaveBeenLastCalledWith(1, { ativo: 1 });
  });

  it('remover terminal com histórico (409) orienta a usar "Desativar"', () => {
    const { tela } = build();
    tela.remove(terminal);
    expect(tela.errorMessage()).toContain('Desativar');
  });
});
