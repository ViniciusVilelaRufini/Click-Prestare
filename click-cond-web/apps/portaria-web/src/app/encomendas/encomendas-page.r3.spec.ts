import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { ApartamentosApi } from '../apartamentos/apartamentos.service';
import { ConfirmService } from '../shared/confirm.service';
import { EncomendasPageComponent } from './encomendas-page.component';
import { Encomenda, EncomendasApi } from './encomendas.service';

/**
 * Rodada 3 (encomendas no console):
 *  - 17: a recarga de 20 s pede a lista leve e só as retiradas recentes; as
 *    retiradas antigas da tela ficam; o recibo carrega a assinatura/foto ao abrir;
 *  - 20: Receber e Notificar não disparam duas vezes;
 *  - 21: Notificar uma encomenda já retirada (409) recarrega a lista;
 *  - 22: bloco nulo e '' são a mesma unidade no lote.
 */
describe('EncomendasPageComponent — rodada 3', () => {
  const enc = (over: Partial<Encomenda>): Encomenda => ({
    id: 1, descricao: 'Caixa', destinatario_apto: '101', destinatario_bloco: 'A',
    recebido_de: null, recebido_em: '2026-11-10T14:30:00', retirado_em: null, retirado_por: null,
    status: 'Aguardando', ...over,
  });
  let api: any;

  function montar(lista: Encomenda[]) {
    api = {
      list: jest.fn(() => of(lista)),
      get: jest.fn((id: number) => of({ ...enc({ id }), status: 'Retirada', retirado_assinatura: 'https://b/assinatura.png', retirado_foto: null })),
      create: jest.fn(() => of({ avisados: 1 })),
      notificar: jest.fn(() => of({ avisados: 1 })),
      retirar: jest.fn(() => of({})),
      remove: jest.fn(() => of({ ok: true })),
      corrigirUnidade: jest.fn(() => of({ avisados: 1 })),
      receber: jest.fn(() => of({ avisados: 1 })),
    };
    TestBed.configureTestingModule({
      imports: [EncomendasPageComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { queryParams: new BehaviorSubject({}) } },
        { provide: EncomendasApi, useValue: api },
        { provide: ApartamentosApi, useValue: { list: () => of([]) } },
        { provide: ConfirmService, useValue: { ask: jest.fn(async () => true) } },
      ],
    });
    const fixture = TestBed.createComponent(EncomendasPageComponent);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => jest.restoreAllMocks());

  it('17: carga pede a lista leve; a recarga, leve e só as retiradas dos últimos 7 dias', () => {
    const f = montar([]);
    expect(api.list).toHaveBeenLastCalledWith(undefined, { leve: true });
    f.componentInstance.recarregarSilencioso();
    expect(api.list).toHaveBeenLastCalledWith(undefined, { leve: true, retiradasDias: 7 });
  });

  it('17: a recarga mantém as retiradas antigas que não vieram e atualiza as recentes', () => {
    const antiga = enc({ id: 1, status: 'Retirada', recebido_em: '2026-01-01T10:00:00', retirado_em: '2026-01-02T10:00:00' });
    const f = montar([antiga, enc({ id: 2 })]);
    const c = f.componentInstance;
    api.list.mockReturnValue(of([enc({ id: 3 }), enc({ id: 2, status: 'Retirada', retirado_em: new Date().toISOString() })]));
    c.recarregarSilencioso();
    const ids = c.encomendas().map((e) => e.id);
    expect(ids.sort()).toEqual([1, 2, 3]);
    expect(c.encomendas().find((e) => e.id === 2)!.status).toBe('Retirada');
  });

  it('17: recibo da lista leve (tem_comprovante) busca a assinatura ao abrir', () => {
    const r = enc({ id: 4, status: 'Retirada', retirado_em: '2026-11-11T10:00:00', retirado_por: 'Ana', tem_comprovante: true });
    const f = montar([r]);
    const c = f.componentInstance;
    expect(c.temComprovante(r)).toBe(true);
    c.abrirComprovante(r);
    expect(api.get).toHaveBeenCalledWith(4);
    expect(c.viewingProof()?.signature).toBe('https://b/assinatura.png');
  });

  it('20: Notificar e Receber com a requisição em andamento não disparam de novo', () => {
    const f = montar([enc({ id: 7 }), enc({ id: 8, status: 'Esperando' })]);
    const c = f.componentInstance;
    const pendNotif = new Subject<any>();
    const pendReceber = new Subject<any>();
    api.notificar.mockReturnValue(pendNotif);
    api.receber.mockReturnValue(pendReceber);
    c.notificar(c.encomendas()[0]);
    c.notificar(c.encomendas()[0]);
    c.receber(c.encomendas()[1]);
    c.receber(c.encomendas()[1]);
    expect(api.notificar).toHaveBeenCalledTimes(1);
    expect(api.receber).toHaveBeenCalledTimes(1);
    expect(c.emAndamento(7)).toBe(true);
    pendNotif.next({ avisados: 1 });
    pendNotif.complete();
    expect(c.emAndamento(7)).toBe(false);
  });

  it('21: Notificar encomenda já retirada (409) mostra o motivo e recarrega a lista', () => {
    const f = montar([enc({ id: 7 })]);
    const c = f.componentInstance;
    api.notificar.mockReturnValue(throwError(() => ({ status: 409, error: { message: 'Esta encomenda já foi retirada.' } })));
    api.list.mockClear();
    c.notificar(c.encomendas()[0]);
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Esta encomenda já foi retirada.');
    expect(api.list).toHaveBeenCalledWith(undefined, { leve: true, retiradasDias: 7 });
  });

  it('22: bloco nulo (pré-registro) e "" (console) são a mesma unidade no lote', () => {
    const f = montar([
      enc({ id: 1, destinatario_apto: '7', destinatario_bloco: null }),
      enc({ id: 2, destinatario_apto: '7', destinatario_bloco: '' }),
    ]);
    const c = f.componentInstance;
    c.toggleSelecionado(1);
    expect(c.deveDesabilitarCheckbox(c.encomendas()[1])).toBe(false);
    expect(c.selecionaveisDoLote().map((e) => e.id)).toEqual([1, 2]);
  });
});
