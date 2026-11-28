import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { FaixaAgenda, InterfoneCrmApi } from '../interfone.service';
import { ToastService } from '../../shared/toast.service';
import { CrmInterfoneComponent, copiarParaDiasUteis } from './crm-interfone.component';

const BASE = { central_contratada: false, ia_portao_ativa: false, numero_portaria: '0', instrucao_entregas: null };
const SEG_CENTRAL: FaixaAgenda = { dia_semana: 1, inicio: '00:00', fim: '07:00', destino: 'central' };

describe('CrmInterfoneComponent', () => {
  let api: {
    clientes: jest.Mock;
    definirContratado: jest.Mock;
    definirCentral: jest.Mock;
    definirIa: jest.Mock;
    salvarPortaria: jest.Mock;
    agenda: jest.Mock;
    salvarAgenda: jest.Mock;
  };
  let toast: { trigger: jest.Mock };

  function render() {
    api = {
      clientes: jest.fn(() =>
        of([
          { id: 1, nome: 'Boa Vista', contratado: false, ...BASE },
          {
            id: 2,
            nome: 'Jardins',
            contratado: true,
            ...BASE,
            central_contratada: true,
            numero_portaria: '9',
            instrucao_entregas: 'Deixe no armário.',
          },
        ]),
      ),
      definirContratado: jest.fn((_id: number, ligado: boolean) => of({ ok: true, contratado: ligado })),
      definirCentral: jest.fn((id: number, ligado: boolean) => of({ id, central_contratada: ligado })),
      definirIa: jest.fn((id: number, ligado: boolean) => of({ id, ia_portao_ativa: ligado })),
      salvarPortaria: jest.fn((id: number, d: any) => of({ id, ...d })),
      agenda: jest.fn(() => of([SEG_CENTRAL])),
      salvarAgenda: jest.fn((_id: number, f: FaixaAgenda[]) => of(f)),
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
    const q = <T extends Element>(sel: string) => el.querySelector(sel) as T;
    const abrir = (id: number) => {
      q<HTMLButtonElement>(`button[data-abrir-central="${id}"]`).click();
      fixture.detectChanges();
    };
    return { fixture, el, caixa, q, abrir };
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

  describe('central Prestare', () => {
    it('abrir o cliente mostra as chaves "Central contratada" e "IA no portão", a portaria e a agenda', () => {
      const { el, q, abrir } = render();
      abrir(2);
      expect(api.agenda).toHaveBeenCalledWith(2);
      expect(el.textContent).toContain('Central contratada');
      expect(el.textContent).toContain('IA no portão (Entrega 2)');
      expect(q<HTMLInputElement>('input[data-central="2"]').checked).toBe(true);
      expect(q<HTMLInputElement>('input[data-ia="2"]').checked).toBe(false);
      expect(q<HTMLInputElement>('input[data-numero-portaria]').value).toBe('9');
      expect(q<HTMLTextAreaElement>('textarea[data-instrucao]').value).toBe('Deixe no armário.');
      expect(q<HTMLInputElement>('input[data-faixa-inicio="1-0"]').value).toBe('00:00');
      expect(q<HTMLSelectElement>('select[data-faixa-destino="1-0"]').value).toBe('central');
    });

    it('sem interfone contratado a chave da central fica desabilitada', () => {
      const { q, abrir } = render();
      abrir(1);
      expect(q<HTMLInputElement>('input[data-central="1"]').disabled).toBe(true);
    });

    it('desligar a central e ligar a IA gravam na API', () => {
      jest.spyOn(window, 'confirm').mockReturnValue(true);
      const { fixture, q, abrir } = render();
      abrir(2);
      q<HTMLInputElement>('input[data-central="2"]').click();
      fixture.detectChanges();
      expect(api.definirCentral).toHaveBeenCalledWith(2, false);
      q<HTMLInputElement>('input[data-ia="2"]').click();
      fixture.detectChanges();
      expect(api.definirIa).toHaveBeenCalledWith(2, true);
    });

    it('erro ao mudar a central volta a chave e mostra o motivo', () => {
      jest.spyOn(window, 'confirm').mockReturnValue(true);
      const { fixture, q, abrir } = render();
      abrir(2);
      api.definirCentral.mockReturnValueOnce(throwError(() => ({ error: { message: 'Contrate o Interfone pelo app antes.' } })));
      q<HTMLInputElement>('input[data-central="2"]').click();
      fixture.detectChanges();
      expect(q<HTMLInputElement>('input[data-central="2"]').checked).toBe(true);
      expect(toast.trigger).toHaveBeenCalledWith('Contrate o Interfone pelo app antes.', 'error');
    });

    it('salva número da portaria e instruções de entrega', () => {
      const { fixture, q, abrir } = render();
      abrir(2);
      const num = q<HTMLInputElement>('input[data-numero-portaria]');
      num.value = '9000';
      num.dispatchEvent(new Event('input'));
      const txt = q<HTMLTextAreaElement>('textarea[data-instrucao]');
      txt.value = 'O morador vai descer.';
      txt.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      q<HTMLButtonElement>('button[data-salvar-portaria]').click();
      expect(api.salvarPortaria).toHaveBeenCalledWith(2, { numero_portaria: '9000', instrucao_entregas: 'O morador vai descer.' });
      expect(toast.trigger).toHaveBeenCalledWith('Portaria de "Jardins" salva.', 'success');
    });

    it('"Copiar para dias úteis" replica a segunda de terça a sexta e salva a agenda', () => {
      const { fixture, q, abrir } = render();
      abrir(2);
      q<HTMLButtonElement>('button[data-copiar-uteis="1"]').click();
      fixture.detectChanges();
      expect(q<HTMLInputElement>('input[data-faixa-inicio="5-0"]').value).toBe('00:00');
      q<HTMLButtonElement>('button[data-salvar-agenda]').click();
      const enviado = api.salvarAgenda.mock.calls[0][1] as FaixaAgenda[];
      expect(api.salvarAgenda.mock.calls[0][0]).toBe(2);
      expect(enviado.map((f) => f.dia_semana)).toEqual([1, 2, 3, 4, 5]);
      expect(enviado.every((f) => f.inicio === '00:00' && f.fim === '07:00' && f.destino === 'central')).toBe(true);
    });

    it('adicionar e remover faixa; erro da API aparece na agenda', () => {
      const { fixture, el, q, abrir } = render();
      abrir(2);
      q<HTMLButtonElement>('button[data-add-faixa="0"]').click();
      fixture.detectChanges();
      expect(q('input[data-faixa-inicio="0-0"]')).not.toBeNull();
      q<HTMLButtonElement>('button[data-remover-faixa="0-0"]').click();
      fixture.detectChanges();
      expect(q('input[data-faixa-inicio="0-0"]')).toBeNull();
      api.salvarAgenda.mockReturnValueOnce(throwError(() => ({ error: { message: 'Faixas sobrepostas no mesmo dia (06:00–08:00).' } })));
      q<HTMLButtonElement>('button[data-salvar-agenda]').click();
      fixture.detectChanges();
      expect(el.querySelector('[data-erro-agenda]')?.textContent).toContain('Faixas sobrepostas');
    });
  });
});

describe('copiarParaDiasUteis', () => {
  it('troca as faixas de segunda a sexta pelas do dia escolhido e mantém o fim de semana', () => {
    const sab: FaixaAgenda = { dia_semana: 6, inicio: '00:00', fim: '24:00', destino: 'central' };
    const ter: FaixaAgenda = { dia_semana: 2, inicio: '10:00', fim: '11:00', destino: 'local' };
    const r = copiarParaDiasUteis([SEG_CENTRAL, ter, sab], 1);
    expect(r.filter((f) => f.dia_semana === 2)).toEqual([{ ...SEG_CENTRAL, dia_semana: 2 }]);
    expect(r.filter((f) => f.dia_semana >= 1 && f.dia_semana <= 5)).toHaveLength(5);
    expect(r).toContainEqual(sab);
  });
});
