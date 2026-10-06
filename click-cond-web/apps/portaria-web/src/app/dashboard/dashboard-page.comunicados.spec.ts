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

  it('sem comunicados recentes diz "Nenhum nos últimos 7 dias"', () => {
    const el = render(0);
    expect(el.textContent).toContain('Nenhum nos últimos 7 dias');
    expect(el.textContent).not.toContain('Nenhum ativo');
  });

  it('com comunicados recentes mostra o número e não o rótulo vazio', () => {
    const el = render(3);
    expect(el.textContent).not.toContain('Nenhum nos últimos 7 dias');
    expect(el.textContent).not.toContain('Nenhum ativo');
  });
});
