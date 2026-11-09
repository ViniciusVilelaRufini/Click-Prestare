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
 * `comunicadosRecentes` conta os comunicados dos últimos 7 dias; comunicado
 * não tem conceito de "ativo", então o rótulo vazio dizia "Nenhum ativo" e
 * contradizia a página de Comunicados.
 */
describe('DashboardPageComponent — card Comunicados', () => {
  /** Célula "Comunicados" do resumo do condomínio (contador + rótulo). */
  function celulaComunicados(el: HTMLElement): HTMLElement {
    const rotulo = (Array.from(el.querySelectorAll('.ps-mini3 small')) as HTMLElement[])
      .find((x) => x.textContent?.trim() === 'Comunicados 7 dias')!;
    return rotulo.parentElement as HTMLElement;
  }

  function render(comunicadosRecentes: number): HTMLElement {
    TestBed.configureTestingModule({
      imports: [DashboardPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const fixture = TestBed.createComponent(DashboardPageComponent);
    fixture.detectChanges();
    fixture.componentInstance.data.set({
      visitantesAtivos: 0, prestadoresAtivos: 0, ocorrenciasPendentes: 0, encomendasAguardando: 0,
      comunicadosRecentes, totalApartamentos: 0, totalMoradores: 0, ultimosEventos: [],
    } as DashboardSummary);
    fixture.componentInstance.loading.set(false);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('sem comunicados recentes mostra zero na janela de 7 dias', () => {
    const el = render(0);
    expect(celulaComunicados(el).querySelector('b')?.textContent?.trim()).toBe('0');
    expect(el.textContent).not.toContain('Nenhum ativo');
  });

  it('com comunicados recentes mostra o número', () => {
    const el = render(3);
    expect(celulaComunicados(el).querySelector('b')?.textContent?.trim()).toBe('3');
    expect(el.textContent).not.toContain('Nenhum ativo');
  });
});
