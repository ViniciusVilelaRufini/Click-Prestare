import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { FinanceiroPageComponent } from './financeiro-page.component';
import { FinanceiroApi } from './financeiro.service';
import { ToastService } from '../shared/toast.service';

/**
 * M6: o síndico abria uma unidade inadimplente, `inadimplente/get` falhava
 * (rede, 5xx, 403) e o modal dizia "Este apartamento está em dia com o
 * condomínio." — parecia que a cobrança tinha sido quitada. Agora o modal
 * mostra o erro e "Tentar de novo".
 */
describe('FinanceiroPageComponent — detalhe da inadimplência com erro', () => {
  const APTO = { apto: '101', bloco: 'A', qtd: 2 };

  function render(getInadimplenteDetail: jest.Mock) {
    const api: any = {
      listLancamentos: jest.fn(() => of({ lancamentos: {}, meses: [] })),
      getGrafico: jest.fn(() => of({})),
      listInadimplentes: jest.fn(() => of({ blocos: [] })),
      getInadimplenteDetail,
    };
    TestBed.configureTestingModule({
      imports: [FinanceiroPageComponent],
      providers: [
        { provide: FinanceiroApi, useValue: api },
        { provide: ToastService, useValue: { info: jest.fn(), success: jest.fn(), error: jest.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(FinanceiroPageComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, comp: fixture.componentInstance, api };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('falha: mostra a mensagem da API e não diz que está em dia', () => {
    const { fixture, el, comp } = render(
      jest.fn(() => throwError(() => ({ status: 403, error: { message: 'Acesso negado ao financeiro.' } }))),
    );
    comp.abrirDetalhesApto(APTO);
    fixture.detectChanges();
    expect(comp.loadingDetalhe()).toBe(false);
    expect(el.textContent).toContain('Acesso negado ao financeiro.');
    expect(el.textContent).not.toContain('está em dia');
    expect(el.textContent).not.toContain('Nenhuma pendência financeira');
  });

  it('"Tentar de novo" refaz a chamada e, dando certo, mostra as faturas', () => {
    const get = jest
      .fn()
      .mockReturnValueOnce(throwError(() => ({ status: 0 })))
      .mockReturnValueOnce(of([{ id: 1, nome: 'Taxa Apto 101', valor: 500, valorString: 'R$ 500,00', data_vencimento: '01/11/2026' }]));
    const { fixture, el, comp } = render(get);
    comp.abrirDetalhesApto(APTO);
    fixture.detectChanges();
    expect(el.textContent).toContain('sem conexão com o servidor');
    const botao = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Tentar de novo'));
    expect(botao).toBeTruthy();
    botao!.click();
    fixture.detectChanges();
    expect(get).toHaveBeenCalledTimes(2);
    expect(comp.erroDetalhe()).toBeNull();
    expect(el.textContent).not.toContain('sem conexão com o servidor');
    expect(el.textContent).toContain('R$ 500,00');
  });

  it('sem pendências de verdade: continua dizendo que está em dia', () => {
    const { fixture, el, comp } = render(jest.fn(() => of([])));
    comp.abrirDetalhesApto(APTO);
    fixture.detectChanges();
    expect(el.textContent).toContain('está em dia');
  });
});
