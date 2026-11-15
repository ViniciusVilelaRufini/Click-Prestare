import { registerLocaleData } from '@angular/common';
import { ɵfindLocaleData } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { DashboardPageComponent } from './dashboard-page.component';
import { DashboardSummary } from './dashboard.service';
import { GuaritaService } from '../guarita/guarita.service';

registerLocaleData(ɵfindLocaleData('en'), 'pt');

/**
 * Portaria com Módulo Guarita: os botões dos portões e os alertas aparecem no
 * painel, e os alertas são atualizados pela MESMA consulta periódica (4 s)
 * que o painel já faz. Sem Guarita, nada muda.
 */
const guarita = { id: 7, nome: 'Guarita garagem', tipo: 'guarita', fabricante: 'linear', ip: '192.168.3.30', porta: 9000, ativo: 1 };
const portao = { id: 1, nome: 'Garagem entrada', tipo_receptor: 1, num_receptor: 1, botao: 1, rele: 1, sentido: 'entrada' };

function render(guaritas: any[]) {
  const guaritaApi = {
    listarGuaritas: jest.fn(() => of(guaritas)),
    portoes: jest.fn(() => of([portao])),
    alertas: jest.fn(() => of([] as any[])),
    abrirPortao: jest.fn(() => of({ enviado: true })),
    marcarAlertaVisto: jest.fn(() => of({ ok: true })),
  };
  TestBed.configureTestingModule({
    imports: [DashboardPageComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: GuaritaService, useValue: guaritaApi },
    ],
  });
  const fixture = TestBed.createComponent(DashboardPageComponent);
  fixture.detectChanges();
  fixture.componentInstance.data.set({
    visitantesAtivos: 0, prestadoresAtivos: 0, ocorrenciasPendentes: 0, encomendasAguardando: 0,
    comunicadosRecentes: 0, totalApartamentos: 0, totalMoradores: 0, ultimosEventos: [],
  } as unknown as DashboardSummary);
  fixture.componentInstance.loading.set(false);
  fixture.detectChanges();
  return { fixture, guaritaApi, el: fixture.nativeElement as HTMLElement };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.useRealTimers();
  TestBed.resetTestingModule();
});

describe('DashboardPageComponent — Módulo Guarita', () => {
  it('sem Guarita: o bloco fica oculto, nada de portão nem alerta, e nenhuma consulta de alertas', () => {
    const { fixture, guaritaApi, el } = render([]);
    const bloco = el.querySelector('app-guarita-portaria') as HTMLElement;
    expect(bloco.style.display).toBe('none');
    expect(bloco.children.length).toBe(0);
    expect(el.textContent).not.toContain('Garagem');
    jest.advanceTimersByTime(12_000);
    fixture.detectChanges();
    expect(guaritaApi.alertas).not.toHaveBeenCalled();
    expect(guaritaApi.portoes).not.toHaveBeenCalled();
    fixture.componentInstance.ngOnDestroy();
  });

  it('com Guarita: botão do portão no painel e alertas a cada consulta de 4 s do painel', () => {
    const { fixture, guaritaApi, el } = render([guarita]);
    expect(el.querySelector('[data-guarita-abrir]')?.textContent?.trim()).toBe('Abrir Garagem entrada');
    expect(guaritaApi.alertas).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(4_000);
    expect(guaritaApi.alertas).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(4_000);
    expect(guaritaApi.alertas).toHaveBeenCalledTimes(3);
    fixture.componentInstance.ngOnDestroy();
    jest.advanceTimersByTime(20_000);
    expect(guaritaApi.alertas).toHaveBeenCalledTimes(3);
  });
});
