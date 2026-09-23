import { TestBed } from '@angular/core/testing';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { VisitantesPageComponent } from './visitantes-page.component';
import { VisitantesService, Pessoa } from './visitantes.service';
import { ConfirmService } from '../shared/confirm.service';

/**
 * A autorização do morador vale 10 min. Vencida, o check-in é recusado — mas
 * a linha mostrava "Liberado" e o botão "Registrar Entrada" só falhava. Agora
 * o status diz "expirado" e o modal pede uma nova janela: cria uma visita
 * nova com ela e registra a entrada nessa visita.
 */
describe('VisitantesPageComponent — entrada com autorização expirada', () => {
  let service: any;

  function build(): VisitantesPageComponent {
    service = {
      listarPessoas: jest.fn(() => of([])),
      checkIn: jest.fn(() => of({ ok: true })),
      novaVisitaPessoa: jest.fn(() => of({ id: 1000009 })),
    };
    TestBed.configureTestingModule({
      imports: [VisitantesPageComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: VisitantesService, useValue: service },
        { provide: ActivatedRoute, useValue: { data: of({}), queryParams: of({}) } },
        { provide: ConfirmService, useValue: { confirm: jest.fn(() => Promise.resolve(true)) } },
      ],
    });
    return TestBed.createComponent(VisitantesPageComponent).componentInstance;
  }

  const pessoa = (expirada: boolean) =>
    ({
      id: 1000005,
      id_pessoa: 2000001,
      nome: 'QA_SECURITY_20260923',
      liberado: 1,
      data_entrada: null,
      data_saida: null,
      autorizacao_expirada: expirada,
      id_apartamento: 106,
      apartamentosVisitados: [
        { id: 106, label: '106/Bloco A', visitanteId: 1000005, liberado: false, auth_status: null, autorizacao_expirada: expirada },
      ],
    }) as unknown as Pessoa;

  it('status da linha é "expirado", não "liberado"', () => {
    const tela = build();
    expect(tela.getStatusVisitante(pessoa(true))).toBe('expirado');
    expect(tela.getStatusVisitante(pessoa(false))).toBe('liberado');
  });

  it('abrir o modal pré-preenche a nova janela (agora → +4h)', () => {
    const tela = build();
    tela.registrarEntradaManual(pessoa(true));
    expect(tela.entradaPrecisaNovaJanela()).toBe(true);
    const ini = new Date(tela.entradaJanelaInicio()).getTime();
    const fim = new Date(tela.entradaJanelaFim()).getTime();
    expect(Math.round((fim - ini) / 3_600_000)).toBe(4);
  });

  it('expirada: cria visita nova com a janela e registra a entrada nela', () => {
    const tela = build();
    tela.registrarEntradaManual(pessoa(true));
    tela.entradaJanelaInicio.set('2026-09-23T08:00');
    tela.entradaJanelaFim.set('2026-09-23T12:00');
    tela.confirmarEntradaModal();
    expect(service.novaVisitaPessoa).toHaveBeenCalledWith(2000001, {
      id_apartamento: 106,
      data_hora_inicio: '2026-09-23T08:00',
      data_hora_termino: '2026-09-23T12:00',
    });
    expect(service.checkIn).toHaveBeenCalledWith(1000009, 106);
  });

  it('janela inválida (fim antes do início) não chama o servidor', () => {
    const tela = build();
    tela.registrarEntradaManual(pessoa(true));
    tela.entradaJanelaInicio.set('2026-09-23T12:00');
    tela.entradaJanelaFim.set('2026-09-23T08:00');
    tela.confirmarEntradaModal();
    expect(service.novaVisitaPessoa).not.toHaveBeenCalled();
    expect(service.checkIn).not.toHaveBeenCalled();
  });

  it('não expirada: registra a entrada na própria visita, como antes', () => {
    const tela = build();
    tela.registrarEntradaManual(pessoa(false));
    tela.confirmarEntradaModal();
    expect(service.novaVisitaPessoa).not.toHaveBeenCalled();
    expect(service.checkIn).toHaveBeenCalledWith(1000005, 106);
  });
});
