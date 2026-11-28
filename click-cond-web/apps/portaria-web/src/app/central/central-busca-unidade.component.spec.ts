import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { CentralApi, UnidadeCentral } from './central-api';
import { CentralBuscaUnidadeComponent } from './central-busca-unidade.component';
import { CentralApiStub } from './central.testing';

describe('CentralBuscaUnidadeComponent', () => {
  afterEach(() => {
    jest.useRealTimers();
    TestBed.resetTestingModule();
  });

  function montar() {
    jest.useFakeTimers();
    TestBed.configureTestingModule({ providers: [{ provide: CentralApi, useClass: CentralApiStub }] });
    const api = TestBed.inject(CentralApi) as unknown as CentralApiStub;
    const f = TestBed.createComponent(CentralBuscaUnidadeComponent);
    f.componentRef.setInput('idCondominio', 1);
    f.detectChanges();
    return { api, f };
  }

  it('trocar de condomínio descarta a busca do condomínio anterior que ainda estava no ar', () => {
    const { api, f } = montar();
    const resposta = new Subject<UnidadeCentral[]>();
    api.unidades.mockReturnValueOnce(resposta);
    f.componentInstance.buscar('10');
    jest.advanceTimersByTime(300);
    expect(api.unidades).toHaveBeenCalledWith(1, '10');
    // O operador troca de condomínio antes de a resposta chegar.
    f.componentRef.setInput('idCondominio', 2);
    f.detectChanges();
    resposta.next([{ id: 100, rotulo: 'Bloco A · Apto 106' }]);
    jest.advanceTimersByTime(300);
    f.detectChanges();
    expect(f.componentInstance.resultados()).toEqual([]);
    expect((f.nativeElement as HTMLElement).querySelector('[data-teste="resultados-unidade"]')).toBeNull();
  });

  it('busca do condomínio atual mostra os resultados', () => {
    const { api, f } = montar();
    api.unidades.mockReturnValueOnce(of([{ id: 100, rotulo: 'Bloco A · Apto 106' }]));
    f.componentInstance.buscar('106');
    jest.advanceTimersByTime(300);
    f.detectChanges();
    expect(f.componentInstance.resultados()).toEqual([{ id: 100, rotulo: 'Bloco A · Apto 106' }]);
  });
});
