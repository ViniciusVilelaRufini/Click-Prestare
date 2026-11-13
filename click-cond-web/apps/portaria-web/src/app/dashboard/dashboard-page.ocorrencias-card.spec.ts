import { registerLocaleData } from '@angular/common';
import { ɵfindLocaleData } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { DashboardPageComponent } from './dashboard-page.component';
import { DashboardSummary } from './dashboard.service';

registerLocaleData(ɵfindLocaleData('en'), 'pt');

/**
 * Cartão de ocorrências: conta as abertas (status diferente de Solucionado,
 * como o app) e só acende "urgente" quando a API aponta aberta com prazo
 * vencido ou de categoria crítica (prioridade 1). Evento de status de dispositivo sai como
 * "Dispositivo" e não leva à lista de ocorrências.
 */
describe('DashboardPageComponent — cartão de ocorrências e eventos de dispositivo', () => {
  function render(parcial: Partial<DashboardSummary>) {
    TestBed.configureTestingModule({
      imports: [DashboardPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const fixture = TestBed.createComponent(DashboardPageComponent);
    fixture.detectChanges();
    fixture.componentInstance.data.set({
      visitantesAtivos: 0, prestadoresAtivos: 0, ocorrenciasPendentes: 0, encomendasAguardando: 0,
      comunicadosRecentes: 0, totalApartamentos: 0, totalMoradores: 0, ultimosEventos: [],
      ...parcial,
    } as DashboardSummary);
    fixture.componentInstance.loading.set(false);
    fixture.detectChanges();
    return fixture;
  }

  function cartao(el: HTMLElement): HTMLElement {
    return el.querySelector('a[href="/ocorrencias"].ps-kpi') as HTMLElement;
  }

  it('abertas sem urgência: mostra só a contagem, sem o selo "urgente"', () => {
    const el = render({ ocorrenciasPendentes: 3, ocorrenciasUrgentes: 0 }).nativeElement as HTMLElement;
    const c = cartao(el);
    expect(c.textContent).toContain('Ocorrências abertas');
    expect(c.textContent).toContain('03');
    expect(c.textContent).not.toContain('urgente');
    expect(c.classList.contains('ps-tone-danger')).toBe(false);
  });

  it('com aberta urgente: mostra o selo', () => {
    const el = render({ ocorrenciasPendentes: 3, ocorrenciasUrgentes: 1 }).nativeElement as HTMLElement;
    const c = cartao(el);
    expect(c.textContent).toContain('urgente');
    expect(c.classList.contains('ps-tone-danger')).toBe(true);
  });

  it('evento "Dispositivo": subtítulo próprio e sem o botão "Ver Ocorrências"', () => {
    const fixture = render({});
    const ev = {
      tipo: 'Dispositivo',
      descricao: 'O dispositivo "Portão" ficou offline.',
      quando: new Date().toISOString(),
      direcao: 'offline' as const,
      detalhes: { id: 9, nome: 'Dispositivos', descricao: 'O dispositivo "Portão" ficou offline.', status: 'Offline', dataEntrada: new Date().toISOString() },
    };
    expect(fixture.componentInstance.subtituloEvento(ev)).toBe('Status do dispositivo');
    fixture.componentInstance.abrirDetalhes(ev);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).not.toContain('Ver Ocorrências');
    expect(el.textContent).toContain('O dispositivo "Portão" ficou offline.');
  });
});
