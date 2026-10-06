import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
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
  const api = { list: jest.fn(), create: jest.fn() };

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

  it('erro de validação aparece dentro do formulário e some após cadastro com sucesso', () => {
    const fixture = montar([]);
    const c = fixture.componentInstance;
    c.showForm = true;
    c.registrar();
    fixture.detectChanges();

    const form = fixture.nativeElement.querySelector('[data-testid="form-encomenda"]') as HTMLElement;
    expect(form.textContent).toContain('Descrição e apto destinatário são obrigatórios.');
    // não duplica o banner fora do formulário
    expect(fixture.nativeElement.textContent.split('são obrigatórios.').length - 1).toBe(1);

    c.novo.descricao = 'Caixa';
    c.selectedApto = apto as any;
    c.registrar();
    fixture.detectChanges();

    expect(c.error()).toBeNull();
    expect(c.showForm).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('são obrigatórios.');
  });

  it('cancelar o formulário limpa o erro', () => {
    const fixture = montar([]);
    const c = fixture.componentInstance;
    c.showForm = true;
    c.registrar();
    fixture.detectChanges();

    const cancelar = (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[])
      .filter((b) => b.textContent?.trim() === 'Cancelar').pop()!;
    cancelar.click();
    fixture.detectChanges();

    expect(c.showForm).toBe(false);
    expect(c.error()).toBeNull();
  });

  it('erro fora do formulário continua no banner', () => {
    const fixture = montar([]);
    fixture.componentInstance.error.set('Erro ao notificar morador');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Erro ao notificar morador');
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
