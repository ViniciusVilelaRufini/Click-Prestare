import { TestBed } from '@angular/core/testing';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { VisitantesPageComponent } from './visitantes-page.component';
import { VisitantesService, Pessoa } from './visitantes.service';
import { ConfirmService } from '../shared/confirm.service';

/**
 * Solicitar mandava sempre o id da visita PRINCIPAL, mesmo com outra unidade
 * escolhida no modal — a API movia essa visita de apartamento e a liberação
 * da unidade original ia junto. Agora o pedido mira a visita da unidade
 * escolhida.
 */
describe('VisitantesPageComponent — Solicitar mira a unidade escolhida', () => {
  let service: any;

  function build(): VisitantesPageComponent {
    service = {
      listarPessoas: jest.fn(() => of([])),
      solicitarAutorizacao: jest.fn(() => of({ ok: true })),
    };
    TestBed.configureTestingModule({
      imports: [VisitantesPageComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: VisitantesService, useValue: service },
        { provide: ActivatedRoute, useValue: { data: of({}), queryParams: of({}) } },
        { provide: ConfirmService, useValue: { ask: jest.fn(() => Promise.resolve(true)) } },
      ],
    });
    return TestBed.createComponent(VisitantesPageComponent).componentInstance;
  }

  const pessoa = () =>
    ({
      id: 1000004, // visita principal (unidade 106)
      id_pessoa: 2000001,
      nome: 'QA_Duas_Unidades',
      totalVisitas: 2,
      id_apartamento: 106,
      apartamentosVisitados: [
        { id: 106, label: '106/A', visitanteId: 1000004, liberado: true },
        { id: 107, label: '107/A', visitanteId: 1000020, liberado: false },
      ],
    }) as unknown as Pessoa;

  it('o modal abre com a unidade da visita principal', () => {
    const tela = build();
    tela.abrirSolicitar(pessoa());
    expect(tela.solicitarAptoId()).toBe(106);
  });

  it('unidade com visita: o pedido vai para a visita dessa unidade', () => {
    const tela = build();
    tela.abrirSolicitar(pessoa());
    tela.solicitarAptoId.set(107);
    tela.confirmarSolicitar();
    expect(service.solicitarAutorizacao).toHaveBeenCalledWith(1000020, 107);
  });

  it('unidade sem visita: manda a principal com a unidade (a API abre uma visita nova lá)', () => {
    const tela = build();
    tela.abrirSolicitar(pessoa());
    tela.solicitarAptoId.set(300);
    tela.confirmarSolicitar();
    expect(service.solicitarAutorizacao).toHaveBeenCalledWith(1000004, 300);
  });
});
