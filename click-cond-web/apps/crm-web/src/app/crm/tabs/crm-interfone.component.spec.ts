import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { InterfoneCrmApi } from '../interfone.service';
import { ToastService } from '../../shared/toast.service';
import { CrmInterfoneComponent } from './crm-interfone.component';

describe('CrmInterfoneComponent', () => {
  let api: { clientes: jest.Mock; definirContratado: jest.Mock };
  let toast: { trigger: jest.Mock };

  function render() {
    api = {
      clientes: jest.fn(() =>
        of([
          { id: 1, nome: 'Boa Vista', contratado: false },
          { id: 2, nome: 'Jardins', contratado: true },
        ]),
      ),
      definirContratado: jest.fn((_id: number, ligado: boolean) => of({ ok: true, contratado: ligado })),
    };
    toast = { trigger: jest.fn() };
    TestBed.configureTestingModule({
      imports: [CrmInterfoneComponent],
      providers: [
        { provide: InterfoneCrmApi, useValue: api },
        { provide: ToastService, useValue: toast },
      ],
    });
    const fixture = TestBed.createComponent(CrmInterfoneComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const caixa = (id: number) => el.querySelector(`input[data-contratado="${id}"]`) as HTMLInputElement;
    return { fixture, el, caixa };
  }

  afterEach(() => {
    jest.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('lista os condomínios com o estado contratado', () => {
    const { el, caixa } = render();
    expect(el.textContent).toContain('Boa Vista');
    expect(caixa(1).checked).toBe(false);
    expect(caixa(2).checked).toBe(true);
    expect(el.textContent).toContain('1 contratado(s)');
  });

  it('contratar pede confirmação, grava e avisa', () => {
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    const { fixture, el, caixa } = render();
    caixa(1).click();
    fixture.detectChanges();
    expect(window.confirm).toHaveBeenCalled();
    expect(api.definirContratado).toHaveBeenCalledWith(1, true);
    expect(toast.trigger).toHaveBeenCalledWith('Interfone de "Boa Vista" contratado.', 'success');
    expect(el.textContent).toContain('2 contratado(s)');
  });

  it('cancelar a confirmação não grava e desmarca', () => {
    jest.spyOn(window, 'confirm').mockReturnValue(false);
    const { caixa } = render();
    caixa(1).click();
    expect(api.definirContratado).not.toHaveBeenCalled();
    expect(caixa(1).checked).toBe(false);
  });

  it('descontratar vai direto; erro volta a caixa e mostra o motivo', () => {
    const confirmar = jest.spyOn(window, 'confirm');
    const { caixa } = render();
    api.definirContratado.mockReturnValueOnce(throwError(() => ({ error: { message: 'Sem permissão.' } })));
    caixa(2).click();
    expect(confirmar).not.toHaveBeenCalled();
    expect(api.definirContratado).toHaveBeenCalledWith(2, false);
    expect(caixa(2).checked).toBe(true);
    expect(toast.trigger).toHaveBeenCalledWith('Sem permissão.', 'error');
  });
});
