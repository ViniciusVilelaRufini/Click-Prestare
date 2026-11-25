import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { DashboardPageComponent } from './dashboard-page.component';

/**
 * Varredura do console 25/11: a API passou a mandar os 15 mais recentes no geral + os 15 de cada
 * tipo. A aba "Todos" continua mostrando só os 15 mais recentes; as abas de tipo mostram os eventos
 * daquele tipo (antes ficavam vazias quando o top 15 geral era só de visitantes).
 */
describe('DashboardPageComponent — Últimos eventos por aba', () => {
  function build(): any {
    TestBed.configureTestingModule({
      imports: [DashboardPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    return TestBed.createComponent(DashboardPageComponent).componentInstance;
  }
  const ev = (tipo: string, dia: number) => ({ tipo, descricao: tipo + dia, quando: new Date(Date.UTC(2026, 10, dia, 12)).toISOString(), detalhes: {} });

  function comEventos(tela: any) {
    const visitantes = Array.from({ length: 15 }, (_, i) => ev('Visitante', 10 + i));
    const ultimosEventos = [...visitantes, ev('Encomenda', 3), ev('Ocorrência', 2)]
      .sort((a, b) => b.quando.localeCompare(a.quando));
    tela.data.set({ ...(tela.data() ?? {}), ultimosEventos });
  }

  it('"Todos" mostra no máximo os 15 mais recentes', () => {
    const tela = build();
    comEventos(tela);
    tela.filtroEvento.set('Todos');
    const r = tela.eventosFiltrados();
    expect(r.length).toBe(15);
    expect(r.every((e: any) => e.tipo === 'Visitante')).toBe(true);
  });

  it('"Encomenda" e "Ocorrência" mostram os seus eventos, fora do top 15 geral', () => {
    const tela = build();
    comEventos(tela);
    tela.filtroEvento.set('Encomenda');
    expect(tela.eventosFiltrados().map((e: any) => e.descricao)).toEqual(['Encomenda3']);
    tela.filtroEvento.set('Ocorrência');
    expect(tela.eventosFiltrados().map((e: any) => e.descricao)).toEqual(['Ocorrência2']);
  });
});
