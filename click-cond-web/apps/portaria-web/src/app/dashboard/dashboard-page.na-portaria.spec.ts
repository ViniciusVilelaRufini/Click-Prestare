import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { DashboardPageComponent } from './dashboard-page.component';
import { statusVisitante } from '../core/status-visitante.util';

/**
 * R2-P1: o painel "Na portaria agora" listava como "Liberado" quem a tela de
 * Visitantes mostra "Janela encerrada" ou "Autorização expirada" — lia o
 * `statusLabel` da API, que diz "Liberado" com `liberado = 1` mesmo com a
 * janela vencida. Agora usa o mesmo critério da tela de Visitantes.
 */
describe('DashboardPageComponent — "Na portaria agora"', () => {
  const AGORA = new Date('2026-11-13T15:00:00Z');
  const h = (horas: number) => new Date(AGORA.getTime() + horas * 3_600_000).toISOString();

  const pessoa = (id: number, extra: Record<string, unknown>) =>
    ({
      id, nome: `P${id}`, noLocal: false, statusLabel: 'Liberado', liberado: 1,
      data_entrada: null, data_saida: null, data_hora_inicio: h(-2), data_hora_termino: h(2),
      ...extra,
    }) as any;

  function build(): DashboardPageComponent {
    TestBed.configureTestingModule({
      imports: [DashboardPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const tela = TestBed.createComponent(DashboardPageComponent).componentInstance;
    tela.agora.set(AGORA);
    return tela;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('fica fora quem tem a janela encerrada ou a autorização expirada', () => {
    const tela = build();
    tela.naPortaria.set([
      pessoa(1, {}), // liberado de fato
      pessoa(2, { data_hora_termino: h(-1) }), // janela encerrada há 1 h
      pessoa(3, { data_hora_termino: h(-942) }),
      pessoa(4, { autorizacao_expirada: true }),
      pessoa(5, { auth_status: 'autorizado', auth_respondido_em: h(-1), data_hora_inicio: null, data_hora_termino: null }),
      pessoa(6, { noLocal: true, statusLabel: 'No condomínio', data_entrada: h(-1) }),
    ]);
    expect(tela.naPortariaVisiveis().map((p) => p.id).sort()).toEqual([1, 6]);
  });

  it('janela que vence enquanto a tela está aberta sai do painel', () => {
    const tela = build();
    tela.naPortaria.set([pessoa(1, { data_hora_termino: h(0.5) })]);
    expect(tela.naPortariaVisiveis()).toHaveLength(1);
    tela.agora.set(new Date(AGORA.getTime() + 3_600_000));
    expect(tela.naPortariaVisiveis()).toHaveLength(0);
  });

  it('o util segue a regra da tela de Visitantes', () => {
    const t = AGORA.getTime();
    expect(statusVisitante(pessoa(1, {}), t)).toBe('liberado');
    expect(statusVisitante(pessoa(2, { data_hora_termino: h(-1) }), t)).toBe('saiu');
    expect(statusVisitante(pessoa(3, { data_hora_inicio: h(1) }), t)).toBe('agendado');
    expect(statusVisitante(pessoa(4, { autorizacao_expirada: true }), t)).toBe('expirado');
    expect(statusVisitante(pessoa(5, { data_entrada: h(-1) }), t)).toBe('presente');
    // Prestador continua liberado depois de sair.
    expect(statusVisitante(pessoa(6, { is_prestador: 1, data_entrada: h(-3), data_saida: h(-2) }), t)).toBe('liberado');
  });
});
