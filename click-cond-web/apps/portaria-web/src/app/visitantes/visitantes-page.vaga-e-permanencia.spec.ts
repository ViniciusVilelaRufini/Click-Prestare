import { TestBed } from '@angular/core/testing';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { VisitantesPageComponent } from './visitantes-page.component';
import { VisitantesService, Pessoa } from './visitantes.service';
import { ConfirmService } from '../shared/confirm.service';

/**
 * Rodada 3 (Visitantes):
 *  - item 6: visitante com vaga vigente sai pelo terminal e continua liberado
 *    (o terminal segue abrindo), mas a linha mostrava "Saiu | Solicitar".
 *  - item 24: quem ficou sem baixa aparecia "No condomínio" para sempre, sem
 *    nenhum sinal de que a permanência é estranha.
 */
describe('VisitantesPageComponent — vaga vigente e permanência longa', () => {
  let confirm: any;

  function build(): VisitantesPageComponent {
    confirm = { ask: jest.fn(() => Promise.resolve(false)) };
    TestBed.configureTestingModule({
      imports: [VisitantesPageComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: VisitantesService, useValue: { listarPessoas: jest.fn(() => of([])), checkOut: jest.fn(() => of({})) } },
        { provide: ActivatedRoute, useValue: { data: of({}), queryParams: of({}) } },
        { provide: ConfirmService, useValue: confirm },
      ],
    });
    return TestBed.createComponent(VisitantesPageComponent).componentInstance;
  }

  const H = 3600_000;
  const saiu = (extra: Record<string, unknown>) =>
    ({
      id: 1000004,
      id_pessoa: 2000001,
      nome: 'QA_Vaga',
      is_prestador: 0,
      liberado: 1,
      data_entrada: new Date(Date.now() - 2 * H).toISOString(),
      data_saida: new Date(Date.now() - H).toISOString(),
      data_hora_inicio: new Date(Date.now() - 3 * H).toISOString(),
      data_hora_termino: new Date(Date.now() + 48 * H).toISOString(),
      ...extra,
    }) as unknown as Pessoa;

  describe('item 6 — vaga vigente', () => {
    it('saiu pelo terminal com vaga vigente: continua "liberado"', () => {
      const tela = build();
      expect(tela.getStatusVisitante(saiu({ temVaga: true }))).toBe('liberado');
    });

    it('sem vaga: continua "saiu"', () => {
      const tela = build();
      expect(tela.getStatusVisitante(saiu({ temVaga: false }))).toBe('saiu');
    });

    it('Dar Baixa avisa que a vaga continua valendo', async () => {
      const tela = build();
      await tela.darBaixa(saiu({ temVaga: true, vagaMorador: 'Ana', data_saida: null }));
      expect(confirm.ask.mock.calls[0][0].message).toContain('vaga cedida por Ana continua valendo');
    });
  });

  describe('item 24 — dentro há muito tempo', () => {
    it('dentro há mais de 12 h: sinaliza', () => {
      const tela = build();
      const p = saiu({ data_entrada: new Date(Date.now() - 13 * H).toISOString(), data_saida: null });
      expect(tela.dentroHaMuitoTempo(p)).toBe(true);
    });

    it('dentro há 2 h, ou já saiu: não sinaliza', () => {
      const tela = build();
      expect(tela.dentroHaMuitoTempo(saiu({ data_saida: null }))).toBe(false);
      expect(tela.dentroHaMuitoTempo(saiu({ data_entrada: new Date(Date.now() - 30 * H).toISOString() }))).toBe(false);
    });
  });
});
