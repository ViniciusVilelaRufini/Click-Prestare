import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { AuthService } from '../../auth/auth.service';
import { DeliveryApi, DeliveryAtendimento } from '../delivery.service';
import { DeliveryStore } from '../delivery.store';
import { DeliveryApiStub } from '../delivery.testing';
import { DeliveryHistoricoComponent } from './delivery-historico.component';

const terminado = {
  id: 3, status: 'CONCLUIDA', estabelecimento: 'Farmácia Histórica', nome_entregador: 'Carlos Entregas',
  modo_entrega: 'UNIDADE', apartamento: { id: 12, bloco: 'C', apto: '303' }, entregador: null,
  eventos: [{ id: 30, status_novo: 'CONCLUIDA', created_at: '2026-10-03T10:30:00.000Z' }],
  created_at: '2026-10-03T10:00:00.000Z',
} as DeliveryAtendimento;

describe('DeliveryHistoricoComponent', () => {
  let api: DeliveryApiStub;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-04T12:00:00'));
    TestBed.configureTestingModule({
      imports: [DeliveryHistoricoComponent],
      providers: [
        DeliveryStore,
        { provide: AuthService, useValue: { porteiroInfo: () => ({ id_condominio: 1, turno: 'Síndico' }) } },
        { provide: DeliveryApi, useClass: DeliveryApiStub },
      ],
    });
    api = TestBed.inject(DeliveryApi) as unknown as DeliveryApiStub;
    api.listHistorico.mockReturnValue(of([terminado]));
    api.resumo.mockReturnValue(of({
      ativos: {}, periodo: { de: '2026-09-28', ate: '2026-10-04', CONCLUIDA: 1, CANCELADA: 0, RECUSADA: 0, total: 1 },
      tempo_medio_atendimento_min: 7.5,
    }));
  });

  afterEach(() => jest.useRealTimers());

  it('carrega 7 dias por padrão e mostra resumo e lista', () => {
    const fixture = TestBed.createComponent(DeliveryHistoricoComponent);
    fixture.detectChanges();
    expect(api.listHistorico).toHaveBeenCalledWith('2026-09-28', '2026-10-04');
    expect(api.resumo).toHaveBeenCalledWith('2026-09-28', '2026-10-04');
    const texto = fixture.nativeElement.textContent;
    expect(texto).toContain('Farmácia Histórica');
    expect(texto).toContain('8 min');
    expect(texto).toContain('Concluídos');
  });

  it('host renderiza como bloco', () => {
    const fixture = TestBed.createComponent(DeliveryHistoricoComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.classList.contains('block')).toBe(true);
  });

  it('troca de período recarrega com o novo intervalo', () => {
    const fixture = TestBed.createComponent(DeliveryHistoricoComponent);
    fixture.detectChanges();
    fixture.componentInstance.mudarPeriodo('hoje');
    expect(api.listHistorico).toHaveBeenLastCalledWith('2026-10-04', '2026-10-04');
  });

  const resumoCom = (concluida: number) => ({
    ativos: {}, periodo: { de: 'x', ate: 'y', CONCLUIDA: concluida, CANCELADA: 0, RECUSADA: 0, total: concluida },
    tempo_medio_atendimento_min: 7.5,
  });
  const cartoes = (fixture: { nativeElement: HTMLElement }) =>
    Array.from(fixture.nativeElement.querySelectorAll('.tabular-nums')).map((e) => (e.textContent ?? '').trim());

  it('resposta atrasada de período anterior não sobrescreve o período atual', () => {
    const fixture = TestBed.createComponent(DeliveryHistoricoComponent);
    fixture.detectChanges();
    const s30 = new Subject<DeliveryAtendimento[]>();
    const sHoje = new Subject<DeliveryAtendimento[]>();
    api.listHistorico.mockReset();
    api.listHistorico.mockReturnValueOnce(s30).mockReturnValueOnce(sHoje);
    const comp = fixture.componentInstance;
    comp.mudarPeriodo('30d');
    comp.mudarPeriodo('hoje');
    const hoje = { ...terminado, id: 99 } as DeliveryAtendimento;
    sHoje.next([hoje]); sHoje.complete();
    expect(comp.lista()).toEqual([hoje]);
    expect(comp.carregando()).toBe(false);
    s30.next([terminado]); s30.complete();
    expect(comp.lista()).toEqual([hoje]);
  });

  it('erro após troca de período deixa lista vazia e resumo nulo', () => {
    const fixture = TestBed.createComponent(DeliveryHistoricoComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.lista().length).toBe(1);
    api.listHistorico.mockReturnValue(throwError(() => new Error('falhou')));
    fixture.componentInstance.mudarPeriodo('30d');
    expect(fixture.componentInstance.lista()).toEqual([]);
    expect(fixture.componentInstance.resumo()).toBeNull();
    expect(fixture.componentInstance.carregando()).toBe(false);
  });

  it('cards mostram placeholder, e não 0, enquanto não há resumo', () => {
    api.listHistorico.mockReturnValue(new Subject<DeliveryAtendimento[]>());
    const fixture = TestBed.createComponent(DeliveryHistoricoComponent);
    fixture.detectChanges();
    expect(cartoes(fixture)).toEqual(['…', '…', '…', '…']);
    api.listHistorico.mockReturnValue(throwError(() => new Error('falhou')));
    fixture.componentInstance.mudarPeriodo('30d');
    fixture.detectChanges();
    expect(cartoes(fixture)).toEqual(['—', '—', '—', '—']);
  });

  it('mostra a contagem de concluídos vinda do resumo', () => {
    api.resumo.mockReturnValue(of(resumoCom(5)));
    const fixture = TestBed.createComponent(DeliveryHistoricoComponent);
    fixture.detectChanges();
    expect(cartoes(fixture)[0]).toBe('5');
  });
});
