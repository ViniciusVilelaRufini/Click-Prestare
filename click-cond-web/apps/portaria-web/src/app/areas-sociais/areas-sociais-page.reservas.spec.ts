import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AreasSociaisPageComponent } from './areas-sociais-page.component';
import { AgendamentoArea, AreasSociaisApi } from './areas-sociais.service';
import { ApartamentosApi } from '../apartamentos/apartamentos.service';
import { ConfirmService } from '../shared/confirm.service';

/**
 * Aba Reservas: as ações sobre a reserva (aprovar, recusar, cancelar) falhavam
 * em silêncio e a lista ficava com o estado velho — o porteiro clicava de novo
 * numa reserva que já tinha mudado. Agora o erro do servidor aparece, a lista
 * é recarregada, e ela também se atualiza sozinha a cada 30 s.
 */
function reserva(overrides: Partial<AgendamentoArea> = {}): AgendamentoArea {
  return {
    id: 1, nomeArea: 'Salão', status: 'pendente', bloco: 'A', apto: '101',
    data_criacao: '01/06/2026 às 10:00', data: '10/06/2099', horaDe: '10:00', horaAte: '12:00',
    ...overrides,
  };
}

function build(opts: { lista?: AgendamentoArea[]; api?: Record<string, unknown>; confirma?: boolean } = {}) {
  const api = {
    listAreas: jest.fn(() => of([])),
    listAgendamentos: jest.fn(() => of(opts.lista ?? [reserva()])),
    updateStatus: jest.fn(() => of({ success: true })),
    cancelar: jest.fn(() => of({ success: true })),
    confirmar: jest.fn(() => of({ success: true })),
    ...opts.api,
  };
  const confirm = { ask: jest.fn(() => Promise.resolve(opts.confirma ?? true)) };
  TestBed.configureTestingModule({
    imports: [AreasSociaisPageComponent],
    providers: [
      { provide: AreasSociaisApi, useValue: api },
      { provide: ApartamentosApi, useValue: { list: jest.fn(() => of([])) } },
      { provide: ConfirmService, useValue: confirm },
    ],
  });
  const f = TestBed.createComponent(AreasSociaisPageComponent);
  f.detectChanges();
  f.componentInstance.tab.set('reservas');
  f.detectChanges();
  return { f, tela: f.componentInstance, api, confirm, el: f.nativeElement as HTMLElement };
}

function botao(el: HTMLElement, texto: string) {
  return Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim() === texto) as
    | HTMLButtonElement
    | undefined;
}

const conflito = { error: { message: 'Esta reserva já foi cancelada.' }, status: 409 };

describe('AreasSociaisPageComponent — ações nas reservas', () => {
  afterEach(() => jest.useRealTimers());

  it('Aprovar recusado pela API: mostra a mensagem do servidor e recarrega a lista', () => {
    const { f, api, el } = build({
      lista: [reserva()],
      api: { updateStatus: jest.fn(() => throwError(() => conflito)) },
    });
    api.listAgendamentos.mockReturnValue(of([reserva({ status: 'cancelado' })]));
    botao(el, 'Aprovar')!.click();
    f.detectChanges();
    expect(el.textContent).toContain('Esta reserva já foi cancelada.');
    expect(api.listAgendamentos).toHaveBeenCalledTimes(2);
    expect(botao(el, 'Aprovar')).toBeUndefined();
  });

  it('Cancelar recusado pela API: mostra a mensagem e recarrega', async () => {
    const { f, tela, api, el } = build({
      lista: [reserva({ status: 'aprovado' })],
      api: { cancelar: jest.fn(() => throwError(() => ({ error: { message: 'Esta reserva já foi recusada.' } }))) },
    });
    await tela.cancelarReserva(1);
    f.detectChanges();
    expect(el.textContent).toContain('Esta reserva já foi recusada.');
    expect(api.listAgendamentos).toHaveBeenCalledTimes(2);
  });

  it('recarrega a lista sozinha a cada 30 s com a aba visível', () => {
    jest.useFakeTimers();
    const { api } = build();
    expect(api.listAgendamentos).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(30_000);
    expect(api.listAgendamentos).toHaveBeenCalledTimes(2);
  });

  it('com a aba escondida, não recarrega', () => {
    jest.useFakeTimers();
    const vis = jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const { api } = build();
    jest.advanceTimersByTime(60_000);
    expect(api.listAgendamentos).toHaveBeenCalledTimes(1);
    vis.mockRestore();
  });
});
