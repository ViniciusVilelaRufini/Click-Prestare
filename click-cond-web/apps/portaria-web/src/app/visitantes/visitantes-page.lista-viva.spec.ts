import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Subject, of, throwError } from 'rxjs';
import { VisitantesPageComponent } from './visitantes-page.component';
import { VisitantesService, Pessoa } from './visitantes.service';
import { ConfirmService } from '../shared/confirm.service';
import { RealtimeService } from '../shared/realtime.service';
import { ApartamentosApi } from '../apartamentos/apartamentos.service';

/**
 * A lista só atualizava com pedido pendente ou com o WebSocket conectado — a
 * entrada/saída pelo terminal não aparecia até recarregar a página. E os erros
 * mostravam "Http failure response for …" em vez do motivo que a API devolve.
 */
describe('VisitantesPageComponent — lista viva e mensagens do servidor', () => {
  let service: any;
  let fixture: ComponentFixture<VisitantesPageComponent>;

  function build(listar = jest.fn(() => of([] as Pessoa[]))): VisitantesPageComponent {
    service = {
      listarPessoas: listar,
      checkOut: jest.fn(() => throwError(() => httpErro('Este visitante não está no condomínio.'))),
      liberar: jest.fn(() => throwError(() => httpErro('Acesso negado: bloqueado.'))),
      checkIn: jest.fn(() => throwError(() => httpErro('A autorização desta visita está expirada.'))),
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
        { provide: RealtimeService, useValue: { connect: () => null, disconnect: jest.fn() } },
        { provide: ApartamentosApi, useValue: { list: () => of([]) } },
      ],
    });
    fixture = TestBed.createComponent(VisitantesPageComponent);
    return fixture.componentInstance;
  }

  const httpErro = (motivo: string) => ({
    error: { message: motivo },
    message: 'Http failure response for https://api/x: 400 Bad Request',
  });

  afterEach(() => jest.useRealTimers());

  it('recarrega a lista sozinha a cada 20 s (sem pedido pendente)', () => {
    jest.useFakeTimers();
    const tela = build();
    fixture.detectChanges(); // ngOnInit
    const antes = service.listarPessoas.mock.calls.length;
    expect(antes).toBe(1);
    jest.advanceTimersByTime(20_000);
    expect(service.listarPessoas.mock.calls.length).toBe(antes + 1);
    tela.ngOnDestroy();
    jest.advanceTimersByTime(60_000);
    expect(service.listarPessoas.mock.calls.length).toBe(antes + 1);
  });

  // A recarga não pode sobrescrever o "Aguardando morador" otimista enquanto
  // o pedido ainda não voltou do servidor.
  it('não recarrega enquanto há uma ação em andamento (Solicitar)', () => {
    jest.useFakeTimers();
    const tela = build();
    const resposta = new Subject<any>();
    service.solicitarAutorizacao = jest.fn(() => resposta);
    fixture.detectChanges();
    const p = { id: 1, id_pessoa: 2, nome: 'QA', totalVisitas: 1, id_apartamento: 106, apartamentosVisitados: [] } as any;
    tela.abrirSolicitar(p);
    tela.confirmarSolicitar();
    const antes = service.listarPessoas.mock.calls.length;
    jest.advanceTimersByTime(20_000);
    expect(service.listarPessoas.mock.calls.length).toBe(antes);
    resposta.next({ ok: true });
    resposta.complete();
    const depoisDaResposta = service.listarPessoas.mock.calls.length; // o next já recarrega
    expect(depoisDaResposta).toBe(antes + 1);
    // Com a resposta, as recargas automáticas (pedido pendente + 20 s) voltam.
    jest.advanceTimersByTime(20_000);
    expect(service.listarPessoas.mock.calls.length).toBeGreaterThan(depoisDaResposta);
    tela.ngOnDestroy();
  });

  it('erro ao carregar mostra o motivo do servidor', () => {
    const tela = build(jest.fn(() => throwError(() => httpErro('Sem acesso a este condomínio.'))));
    tela.carregar();
    expect(tela.error()).toContain('Sem acesso a este condomínio.');
    expect(tela.error()).not.toContain('Http failure');
  });

  it('erro ao dar baixa mostra o motivo do servidor', async () => {
    const tela = build();
    await tela.darBaixa({ id: 1, nome: 'QA' } as any);
    expect(tela.error()).toContain('Este visitante não está no condomínio.');
  });

  // Rodada 3, item 9: os dois saem de dentro de um modal — o erro aparece nele.
  it('erro ao liberar e ao registrar entrada mostra o motivo do servidor (no modal)', () => {
    const tela = build();
    const p = { id: 1, nome: 'QA', apartamentosVisitados: [{ id: 106, label: '106', visitanteId: 1 }] } as any;
    tela.liberarAcessoEFechar(p);
    expect(tela.erroModal()).toContain('Acesso negado: bloqueado.');
    tela.registrarEntradaManual(p);
    tela.confirmarEntradaModal();
    expect(tela.erroModal()).toContain('A autorização desta visita está expirada.');
  });
});
