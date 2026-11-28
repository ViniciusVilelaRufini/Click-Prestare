import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { CentralOperadoresApi } from '../interfone.service';
import { ToastService } from '../../shared/toast.service';
import { CrmCentralOperadoresComponent } from './crm-central-operadores.component';

const ANA = {
  id: 7,
  nome: 'Ana Central',
  email: 'ana@prestare.test',
  ativo: true,
  trocar_senha: false,
  ultimo_acesso: null,
  created_at: '2026-11-28T10:00:00Z',
};

describe('CrmCentralOperadoresComponent', () => {
  let api: { listar: jest.Mock; criar: jest.Mock; definirAtivo: jest.Mock; novaSenha: jest.Mock };
  let toast: { trigger: jest.Mock };

  function render() {
    api = {
      listar: jest.fn(() => of([ANA])),
      criar: jest.fn(() => of({ id: 8, senha_temporaria: 'Tmp123abcXYZ' })),
      definirAtivo: jest.fn((id: number, ligado: boolean) => of({ id, ativo: ligado })),
      novaSenha: jest.fn(() => of({ senha_temporaria: 'Nova456defUV' })),
    };
    toast = { trigger: jest.fn() };
    TestBed.configureTestingModule({
      imports: [CrmCentralOperadoresComponent],
      providers: [
        { provide: CentralOperadoresApi, useValue: api },
        { provide: ToastService, useValue: toast },
      ],
    });
    const fixture = TestBed.createComponent(CrmCentralOperadoresComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const q = <T extends Element>(sel: string) => el.querySelector(sel) as T;
    return { fixture, el, q };
  }

  afterEach(() => {
    jest.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('lista os operadores', () => {
    const { el, q } = render();
    expect(el.textContent).toContain('Operadores da central');
    expect(el.textContent).toContain('Ana Central');
    expect(el.textContent).toContain('ana@prestare.test');
    expect(q<HTMLInputElement>('input[data-ativo="7"]').checked).toBe(true);
  });

  it('criar mostra a senha temporária uma vez, com botão copiar', async () => {
    const escrever = jest.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText: escrever } });
    const { fixture, el, q } = render();
    const nome = q<HTMLInputElement>('input[data-novo-nome]');
    nome.value = 'Bruno';
    nome.dispatchEvent(new Event('input'));
    const email = q<HTMLInputElement>('input[data-novo-email]');
    email.value = 'bruno@prestare.test';
    email.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    q<HTMLButtonElement>('button[data-criar]').click();
    fixture.detectChanges();
    expect(api.criar).toHaveBeenCalledWith({ nome: 'Bruno', email: 'bruno@prestare.test' });
    expect(api.listar).toHaveBeenCalledTimes(2);
    expect(q('[data-senha-temporaria]')?.textContent).toContain('Tmp123abcXYZ');
    q<HTMLButtonElement>('button[data-copiar-senha]').click();
    await Promise.resolve();
    expect(escrever).toHaveBeenCalledWith(expect.stringContaining('Tmp123abcXYZ'));
    // Fechar o aviso: a senha some da tela e não volta.
    q<HTMLButtonElement>('button[data-fechar-senha]').click();
    fixture.detectChanges();
    expect(el.textContent).not.toContain('Tmp123abcXYZ');
  });

  it('desativar pede confirmação e grava; erro volta a caixa', () => {
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    const { fixture, q } = render();
    api.definirAtivo.mockReturnValueOnce(throwError(() => ({ error: { message: 'Falhou.' } })));
    q<HTMLInputElement>('input[data-ativo="7"]').click();
    fixture.detectChanges();
    expect(window.confirm).toHaveBeenCalled();
    expect(api.definirAtivo).toHaveBeenCalledWith(7, false);
    expect(q<HTMLInputElement>('input[data-ativo="7"]').checked).toBe(true);
    expect(toast.trigger).toHaveBeenCalledWith('Falhou.', 'error');
    q<HTMLInputElement>('input[data-ativo="7"]').click();
    fixture.detectChanges();
    expect(q<HTMLInputElement>('input[data-ativo="7"]').checked).toBe(false);
  });

  it('nova senha pede confirmação e mostra a temporária', () => {
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    const { fixture, q } = render();
    q<HTMLButtonElement>('button[data-nova-senha="7"]').click();
    fixture.detectChanges();
    expect(api.novaSenha).toHaveBeenCalledWith(7);
    expect(q('[data-senha-temporaria]')?.textContent).toContain('Nova456defUV');
  });
});
