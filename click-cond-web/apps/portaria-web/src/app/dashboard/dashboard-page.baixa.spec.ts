import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { DashboardPageComponent } from './dashboard-page.component';

/**
 * Modal "Registrar baixa": com a busca vazia e ninguém dentro, dizia
 * "Ninguém no condomínio encontrado com este filtro" — não havia filtro.
 */
describe('DashboardPageComponent — estado vazio da baixa', () => {
  function build(): DashboardPageComponent {
    TestBed.configureTestingModule({
      imports: [DashboardPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    return TestBed.createComponent(DashboardPageComponent).componentInstance;
  }

  it('ninguém dentro e sem busca', () => {
    const tela = build();
    tela.pessoasNoLocal.set([]);
    expect(tela.mensagemVaziaBaixa()).toBe('Ninguém está no condomínio agora.');
  });

  it('há gente dentro, mas a busca não encontrou', () => {
    const tela = build();
    tela.pessoasNoLocal.set([{ id: 1, nome: 'QA_SECURITY_20260923', doc_identificacao: null } as any]);
    tela.buscaPessoaBaixa.set('fulano');
    expect(tela.mensagemVaziaBaixa()).toBe('Nenhum resultado para "fulano".');
  });
});
