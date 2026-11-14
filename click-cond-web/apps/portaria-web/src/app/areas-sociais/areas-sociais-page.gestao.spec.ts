import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AreasSociaisPageComponent } from './areas-sociais-page.component';
import { AgendamentoArea, AreaSocial, AreasSociaisApi } from './areas-sociais.service';
import { ApartamentosApi } from '../apartamentos/apartamentos.service';
import { ConfirmService } from '../shared/confirm.service';

/**
 * Gestão de espaços e da fila de reservas no console:
 *  - excluir espaço recusado pela API mostra o motivo (antes sumia em silêncio);
 *  - "Exigir confirmação de presença" passa a ser configurável;
 *  - modal Agendar: bloco sem "Bloco Bloco A" e com os horários já ocupados;
 *  - fila de reservas com filtro (canceladas e recusadas fora por padrão) e
 *    "aprovada por" visível.
 */
const AREA: AreaSocial = { id: 30, nome: 'Salão', imagem: '', exige_confirmacao: 0 } as AreaSocial;

function reserva(overrides: Partial<AgendamentoArea> = {}): AgendamentoArea {
  return {
    id: 1, nomeArea: 'Salão', status: 'pendente', bloco: 'A', apto: '101',
    data_criacao: '01/06/2026 às 10:00', data: '10/06/2099', horaDe: '10:00', horaAte: '12:00',
    ...overrides,
  };
}

function build(opts: { lista?: AgendamentoArea[]; api?: Record<string, unknown>; aptos?: any[] } = {}) {
  const api = {
    listAreas: jest.fn(() => of([AREA])),
    listAgendamentos: jest.fn(() => of(opts.lista ?? [])),
    removeArea: jest.fn(() => of({ success: true })),
    insertArea: jest.fn(() => of({ success: true })),
    updateArea: jest.fn(() => of({ success: true })),
    getArea: jest.fn(() => of({ agendamentos: [], manutencoes: [] })),
    ...opts.api,
  };
  TestBed.configureTestingModule({
    imports: [AreasSociaisPageComponent],
    providers: [
      { provide: AreasSociaisApi, useValue: api },
      { provide: ApartamentosApi, useValue: { list: jest.fn(() => of(opts.aptos ?? [])) } },
      { provide: ConfirmService, useValue: { ask: jest.fn(() => Promise.resolve(true)) } },
    ],
  });
  const f = TestBed.createComponent(AreasSociaisPageComponent);
  f.detectChanges();
  return { f, tela: f.componentInstance, api, el: f.nativeElement as HTMLElement };
}

describe('AreasSociaisPageComponent — gestão de espaços e da fila', () => {
  it('Excluir espaço recusado pela API: mostra o motivo e mantém o espaço', async () => {
    const { f, tela, el } = build({
      api: {
        removeArea: jest.fn(() =>
          throwError(() => ({ error: { message: 'Este espaço tem 1 reserva ativa por acontecer. Cancele-a antes de excluir o espaço.' } })),
        ),
      },
    });
    await tela.excluirArea(30);
    f.detectChanges();
    expect(el.textContent).toContain('Cancele-a antes de excluir o espaço.');
    expect(tela.areas().length).toBe(1);
  });

  it('"Exigir confirmação de presença" vai no cadastro e volta marcado na edição', () => {
    const { tela, api } = build();
    tela.abrirModalArea();
    tela.novaArea.nome = 'Churrasqueira';
    tela.novaArea.exige_confirmacao = true;
    tela.salvarArea();
    expect(api.insertArea).toHaveBeenCalledWith(expect.objectContaining({ exige_confirmacao: 1 }));

    tela.abrirModalEditarArea({ ...AREA, exige_confirmacao: 1 });
    expect(tela.novaArea.exige_confirmacao).toBe(true);
    tela.novaArea.exige_confirmacao = false;
    tela.salvarArea();
    expect(api.updateArea).toHaveBeenCalledWith(expect.objectContaining({ exige_confirmacao: 0 }));
  });

  it('modal Agendar: bloco já com a palavra "Bloco" não repete', () => {
    const { f, tela, el } = build({ aptos: [{ id: 7, apto: '101', bloco: 'Bloco A' }, { id: 8, apto: '102', bloco: 'B' }] });
    tela.abrirModalReserva(AREA);
    f.detectChanges();
    expect(el.textContent).not.toContain('Bloco Bloco');
    expect(el.textContent).toContain('Bloco A');
    expect(el.textContent).toContain('Bloco B');
  });

  it('modal Agendar: mostra os horários já ocupados no dia escolhido', () => {
    const { f, tela, el } = build({
      api: {
        getArea: jest.fn(() =>
          of({
            agendamentos: [
              { id: 1, data: '20/06/2099', horaDe: '18:00', horaAte: '22:00', status: 'aprovado', bloco: 'A', apto: '101' },
              { id: 2, data: '20/06/2099', horaDe: '10:00', horaAte: '12:00', status: 'cancelado', bloco: 'A', apto: '102' },
              { id: 3, data: '21/06/2099', horaDe: '08:00', horaAte: '09:00', status: 'pendente', bloco: 'A', apto: '103' },
            ],
            manutencoes: [],
          }),
        ),
      },
    });
    tela.abrirModalReserva(AREA);
    tela.novaReserva.data = '2099-06-20';
    f.detectChanges();
    expect(tela.ocupadosNoDia().map((o) => o.horaDe)).toEqual(['18:00']);
    expect(el.textContent).toContain('18:00 - 22:00');
  });

  describe('fila de reservas', () => {
    const lista = [
      reserva({ id: 1, status: 'pendente' }),
      reserva({ id: 2, status: 'aprovado', aprovado_por: 'Carlos' }),
      reserva({ id: 3, status: 'cancelado', nomeArea: 'Quadra Cancelada' }),
      reserva({ id: 4, status: 'recusado', nomeArea: 'Piscina Recusada' }),
    ];

    it('por padrão mostra só as ativas; "Todas" traz canceladas e recusadas', () => {
      const { f, tela, el } = build({ lista });
      tela.tab.set('reservas');
      f.detectChanges();
      expect(tela.agendamentosVisiveis().map((a) => a.id)).toEqual([1, 2]);
      expect(el.textContent).not.toContain('Quadra Cancelada');
      tela.filtroReservas.set('todas');
      f.detectChanges();
      expect(el.textContent).toContain('Quadra Cancelada');
      expect(el.textContent).toContain('Piscina Recusada');
      tela.filtroReservas.set('pendentes');
      expect(tela.agendamentosVisiveis().map((a) => a.id)).toEqual([1]);
    });

    it('aprovada mostra quem aprovou ou agendou', () => {
      const { f, tela, el } = build({ lista });
      tela.tab.set('reservas');
      f.detectChanges();
      expect(el.textContent).toContain('Aprovada por Carlos');
    });
  });
});
