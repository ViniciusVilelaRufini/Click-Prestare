import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ApartamentosApi } from '../apartamentos/apartamentos.service';
import { EncomendasPageComponent } from './encomendas-page.component';
import { Encomenda, EncomendasApi } from './encomendas.service';

const enc = (over: Partial<Encomenda>): Encomenda => ({
  id: 1, descricao: 'Caixa', destinatario_apto: '101', destinatario_bloco: 'A',
  recebido_de: null, recebido_em: '2026-10-05T14:30:00', retirado_em: null, retirado_por: null,
  status: 'Aguardando', ...over,
});

describe('EncomendasPageComponent — erro do formulário e coluna Recebida', () => {
  const apto = { id: 1, bloco: 'A', apto: '101' };
  const api = { list: jest.fn(), create: jest.fn(), notificar: jest.fn() };

  function montar(lista: Encomenda[]) {
    api.list.mockReturnValue(of(lista));
    api.create.mockReturnValue(of({}));
    TestBed.configureTestingModule({
      imports: [EncomendasPageComponent],
      providers: [
        provideRouter([]),
        { provide: EncomendasApi, useValue: api },
        { provide: ApartamentosApi, useValue: { list: () => of([apto]) } },
      ],
    });
    const fixture = TestBed.createComponent(EncomendasPageComponent);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => jest.clearAllMocks());

  // O componente é OnPush: só um evento de clique (ou signal) marca a view como suja,
  // então os testes abrem o formulário e confirmam pelos botões, como o porteiro faz.
  function clicar(fixture: ComponentFixture<EncomendasPageComponent>, rotulo: string) {
    const botoes = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    botoes.filter((b) => b.textContent?.trim() === rotulo).pop()!.click();
    fixture.detectChanges();
  }
  const formEl = (fixture: ComponentFixture<EncomendasPageComponent>) =>
    fixture.nativeElement.querySelector('[data-testid="form-encomenda"]') as HTMLElement;

  it('erro de validação aparece dentro do formulário e some após cadastro com sucesso', () => {
    const fixture = montar([]);
    const c = fixture.componentInstance;
    clicar(fixture, 'Receber encomenda');
    clicar(fixture, 'Confirmar recebimento');

    expect(formEl(fixture).textContent).toContain('Descrição e apto destinatário são obrigatórios.');
    expect(c.formError()).toBe('Descrição e apto destinatário são obrigatórios.');
    expect(c.error()).toBeNull();
    // não duplica o banner fora do formulário
    expect(fixture.nativeElement.textContent.split('são obrigatórios.').length - 1).toBe(1);

    c.novo.descricao = 'Caixa';
    c.selectedApto = apto as any;
    clicar(fixture, 'Confirmar recebimento');

    expect(c.formError()).toBeNull();
    expect(c.error()).toBeNull();
    expect(c.showForm).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('são obrigatórios.');
  });

  it('falha do create aparece no formulário (formError), não no banner global', () => {
    const fixture = montar([]);
    api.create.mockReturnValue(throwError(() => ({ message: 'Apto inexistente' })));
    const c = fixture.componentInstance;
    clicar(fixture, 'Receber encomenda');
    c.novo.descricao = 'Caixa';
    c.selectedApto = apto as any;
    clicar(fixture, 'Confirmar recebimento');

    expect(c.formError()).toBe('Apto inexistente');
    expect(c.error()).toBeNull();
    expect(formEl(fixture).textContent).toContain('Apto inexistente');
    expect(fixture.nativeElement.textContent.split('Apto inexistente').length - 1).toBe(1);
  });

  it('cancelar o formulário limpa o erro de validação', () => {
    const fixture = montar([]);
    const c = fixture.componentInstance;
    clicar(fixture, 'Receber encomenda');
    clicar(fixture, 'Confirmar recebimento');
    expect(c.formError()).not.toBeNull();

    clicar(fixture, 'Cancelar');

    expect(c.showForm).toBe(false);
    expect(c.formError()).toBeNull();
  });

  it('erro de ação aparece no banner global mesmo com o formulário aberto, e não dentro dele', () => {
    const fixture = montar([]);
    const c = fixture.componentInstance;
    clicar(fixture, 'Receber encomenda');
    c.error.set('Erro ao notificar morador');
    fixture.detectChanges();

    expect(formEl(fixture)).toBeTruthy();
    expect(formEl(fixture).textContent).not.toContain('Erro ao notificar morador');
    expect(fixture.nativeElement.textContent).toContain('Erro ao notificar morador');
    expect(c.formError()).toBeNull();
  });

  it('erro fora do formulário continua no banner', () => {
    const fixture = montar([]);
    fixture.componentInstance.error.set('Erro ao notificar morador');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Erro ao notificar morador');
  });

  it('banner de erro de ação some após uma nova tentativa bem-sucedida e após recarregar', () => {
    const fixture = montar([enc({ id: 7, status: 'Aguardando' })]);
    const c = fixture.componentInstance;
    const e = c.encomendas()[0];

    api.notificar.mockReturnValue(throwError(() => ({ message: 'Erro ao notificar morador' })));
    c.notificar(e);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Erro ao notificar morador');

    api.notificar.mockReturnValue(of({}));
    c.notificar(e);
    fixture.detectChanges();
    expect(c.error()).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Erro ao notificar morador');

    c.error.set('Erro ao receber encomenda');
    c.carregar();
    fixture.detectChanges();
    expect(c.error()).toBeNull();
  });

  it('coluna Recebida mostra "—" para Esperando e a data para os demais (tabela e cartões)', () => {
    const fixture = montar([
      enc({ id: 1, status: 'Esperando' }),
      enc({ id: 2, status: 'Aguardando' }),
      enc({ id: 3, status: 'Retirada', retirado_em: '2026-10-05T16:00:00', retirado_por: 'João (Morador)' }),
    ]);
    const textos = (sel: string) =>
      (Array.from(fixture.nativeElement.querySelectorAll(sel)) as HTMLElement[]).map((el) => el.textContent?.trim());

    expect(textos('[data-testid="recebida-tabela"]')).toEqual(['—', '05/10 14:30', '05/10 14:30']);
    expect(textos('[data-testid="recebida-card"]')).toEqual(['—', '05/10 14:30', '05/10 14:30']);
  });
});
