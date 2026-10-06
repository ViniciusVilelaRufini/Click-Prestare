import { registerLocaleData } from '@angular/common';
import { ɵfindLocaleData } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { DashboardPageComponent } from './dashboard-page.component';
import { DashboardSummary } from './dashboard.service';

// O jest não carrega os locales ESM do Angular; basta um locale 'pt' para o date pipe do cabeçalho.
registerLocaleData(ɵfindLocaleData('en'), 'pt');

/**
 * Encomenda "Esperando" (a chegar) chega do API com dataEntrada = null; o modal
 * de detalhes mostrava "Recebido em" em branco.
 */
describe('DashboardPageComponent — modal de encomenda: Recebido em', () => {
  function recebidoEm(dataEntrada: string | null): string {
    TestBed.configureTestingModule({
      imports: [DashboardPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const fixture = TestBed.createComponent(DashboardPageComponent);
    fixture.detectChanges();
    const c = fixture.componentInstance;
    c.data.set({
      visitantesAtivos: 0, prestadoresAtivos: 0, ocorrenciasPendentes: 0, encomendasAguardando: 0,
      comunicadosRecentes: 0, totalApartamentos: 0, totalMoradores: 0, ultimosEventos: [],
    } as DashboardSummary);
    c.loading.set(false);
    c.eventoSelecionado.set({
      tipo: 'Encomenda',
      descricao: 'Caixa',
      quando: '2026-10-05T14:30:00',
      detalhes: { id: 1, nome: 'Caixa', blocoApto: 'A / 101', recebidoDe: 'Correios', status: 'Esperando', dataEntrada },
    });
    fixture.detectChanges();

    const rotulo = (Array.from(fixture.nativeElement.querySelectorAll('span')) as HTMLElement[])
      .find((x) => x.textContent?.trim() === 'Recebido em')!;
    return (rotulo.nextElementSibling as HTMLElement).textContent!.trim();
  }

  it('sem data de entrada (a chegar) mostra "A chegar", não vazio', () => {
    expect(recebidoEm(null)).toBe('A chegar');
  });

  it('com data de entrada mostra a data formatada', () => {
    expect(recebidoEm('2026-10-05T14:30:00')).toBe('05/10/2026 14:30');
  });
});
