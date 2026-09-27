import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { DashboardPageComponent } from './dashboard-page.component';

/**
 * Eventos de status de dispositivo ("O dispositivo X ficou offline" /
 * "voltou a ficar online") vinham com selo Saída/Entrada, herdado da lógica
 * de acesso de pessoas. Eles têm selo próprio: Offline/Online. Eventos reais
 * de acesso de pessoas continuam mostrando Entrada/Saída/Bloqueado.
 */
describe('DashboardPageComponent — direcaoLabel (selo dos eventos)', () => {
  function build(): DashboardPageComponent {
    TestBed.configureTestingModule({
      imports: [DashboardPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    return TestBed.createComponent(DashboardPageComponent).componentInstance;
  }

  it('evento de dispositivo offline mostra selo "Offline", não "Saída"', () => {
    const tela = build();
    expect(tela.direcaoLabel('offline', 'Ocorrência')).toBe('Offline');
  });

  it('evento de dispositivo online mostra selo "Online", não "Entrada"', () => {
    const tela = build();
    expect(tela.direcaoLabel('online', 'Ocorrência')).toBe('Online');
  });

  it('acesso real de pessoa continua mostrando Entrada/Saída', () => {
    const tela = build();
    expect(tela.direcaoLabel('entrada', 'Acesso Facial')).toBe('Entrada');
    expect(tela.direcaoLabel('saida', 'Acesso Facial')).toBe('Saída');
  });

  it('acesso negado/bloqueado continua mostrando "Bloqueado"', () => {
    const tela = build();
    expect(tela.direcaoLabel('negado', 'Acesso Facial')).toBe('Bloqueado');
    expect(tela.direcaoLabel('bloqueado', 'Acesso Facial')).toBe('Bloqueado');
  });

  it('sem direção definida, cai no tipo do evento (ex.: Encomenda)', () => {
    const tela = build();
    expect(tela.direcaoLabel(undefined, 'Encomenda')).toBe('Encomenda');
  });
});
