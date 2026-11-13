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

  it('Recusar pede um motivo opcional e o envia', () => {
    const { f, api, el } = build({ lista: [reserva()] });
    botao(el, 'Recusar')!.click();
    f.detectChanges();
    const dialogo = el.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialogo).toBeTruthy();
    expect(api.updateStatus).not.toHaveBeenCalled();
    const campo = dialogo.querySelector('textarea') as HTMLTextAreaElement;
    campo.value = '  Área em obra  ';
    campo.dispatchEvent(new Event('input'));
    const recusar = Array.from(dialogo.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Recusar')!;
    recusar.click();
    f.detectChanges();
    expect(api.updateStatus).toHaveBeenCalledWith(1, false, 'Área em obra');
    expect(el.querySelector('[role="dialog"]')).toBeNull();
  });

  describe('confirmação de presença e reservas já ocorridas', () => {
    // 10/06/2026 às 15:00 no relógio do navegador.
    beforeEach(() => jest.useFakeTimers().setSystemTime(new Date(2026, 5, 10, 15, 0)));

    it('aprovada de hoje, área com confirmação, sem confirmar: selo e botão "Confirmar presença"', () => {
      const { f, api, el } = build({
        lista: [reserva({ status: 'aprovado', data: '10/06/2026', horaDe: '16:00', horaAte: '18:00', exige_confirmacao: true, confirmada_em: null })],
      });
      expect(el.textContent).toContain('aguardando confirmação');
      botao(el, 'Confirmar presença')!.click();
      f.detectChanges();
      expect(api.confirmar).toHaveBeenCalledWith(1);
      expect(el.textContent).not.toContain('aguardando confirmação');
      expect(botao(el, 'Confirmar presença')).toBeUndefined();
    });

    it('sem o botão quando já confirmada, quando a área não exige ou quando não é hoje', () => {
      const { el } = build({
        lista: [
          reserva({ id: 1, status: 'aprovado', data: '10/06/2026', horaDe: '16:00', horaAte: '18:00', exige_confirmacao: true, confirmada_em: '2026-06-10T14:00:00Z' }),
          reserva({ id: 2, status: 'aprovado', data: '10/06/2026', horaDe: '16:00', horaAte: '18:00', exige_confirmacao: false }),
          reserva({ id: 3, status: 'aprovado', data: '11/06/2026', horaDe: '16:00', horaAte: '18:00', exige_confirmacao: true }),
        ],
      });
      expect(botao(el, 'Confirmar presença')).toBeUndefined();
      expect(el.textContent).not.toContain('aguardando confirmação');
    });

    it('Confirmar presença com erro: mostra a mensagem e recarrega', () => {
      const { f, api, el } = build({
        lista: [reserva({ status: 'aprovado', data: '10/06/2026', horaDe: '16:00', horaAte: '18:00', exige_confirmacao: true })],
        api: { confirmar: jest.fn(() => throwError(() => ({ error: { message: 'Agendamento não encontrado.' } }))) },
      });
      botao(el, 'Confirmar presença')!.click();
      f.detectChanges();
      expect(el.textContent).toContain('Agendamento não encontrado.');
      expect(api.listAgendamentos).toHaveBeenCalledTimes(2);
    });

    it('reserva aprovada cujo horário já terminou não oferece "Cancelar reserva"', () => {
      const { el } = build({
        lista: [reserva({ status: 'aprovado', data: '10/06/2026', horaDe: '10:00', horaAte: '12:00' })],
      });
      expect(botao(el, 'Cancelar reserva')).toBeUndefined();
    });

    it('reserva aprovada ainda por acontecer oferece "Cancelar reserva"', () => {
      const { el } = build({
        lista: [reserva({ status: 'aprovado', data: '10/06/2026', horaDe: '20:00', horaAte: '00:00' })],
      });
      expect(botao(el, 'Cancelar reserva')).toBeTruthy();
    });
  });

  it('com a aba escondida, não recarrega', () => {
    jest.useFakeTimers();
    const vis = jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const { api } = build();
    jest.advanceTimersByTime(60_000);
    expect(api.listAgendamentos).toHaveBeenCalledTimes(1);
    vis.mockRestore();
  });

  it('falha da recarga automática não apaga a mensagem de erro da ação', () => {
    jest.useFakeTimers();
    const { f, api, el } = build({
      lista: [reserva()],
      api: { updateStatus: jest.fn(() => throwError(() => conflito)) },
    });
    botao(el, 'Aprovar')!.click();
    f.detectChanges();
    api.listAgendamentos.mockReturnValue(throwError(() => ({ error: { message: 'Sem conexão' } })));
    jest.advanceTimersByTime(30_000);
    f.detectChanges();
    expect(el.textContent).toContain('Esta reserva já foi cancelada.');
    expect(el.textContent).toContain('Sem conexão');
    // Voltou a carregar: o aviso da recarga some, o da ação continua.
    api.listAgendamentos.mockReturnValue(of([reserva()]));
    jest.advanceTimersByTime(30_000);
    f.detectChanges();
    expect(el.textContent).not.toContain('Sem conexão');
    expect(el.textContent).toContain('Esta reserva já foi cancelada.');
  });
});
