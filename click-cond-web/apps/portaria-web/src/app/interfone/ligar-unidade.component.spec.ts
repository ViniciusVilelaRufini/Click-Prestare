import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { ApartamentosApi } from '../apartamentos/apartamentos.service';
import { HOJE } from './interfone.testing';
import { InterfoneStore } from './interfone.store';
import { LigarUnidadeComponent } from './ligar-unidade.component';

function storeFalso() {
  return {
    hoje: signal(HOJE),
    emChamada: signal<unknown>(null),
    discando: signal(false),
    atendendo: signal<number | null>(null),
    ligar: jest.fn(() => Promise.resolve()),
  };
}

describe('LigarUnidadeComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('busca a unidade e LIGAR chama o store com o id e o rótulo', async () => {
    jest.useFakeTimers();
    try {
      const store = storeFalso();
      const aptos = { list: jest.fn(() => of([{ id: 10, bloco: 'A', apto: '101' }])) };
      TestBed.configureTestingModule({
        imports: [LigarUnidadeComponent],
        providers: [
          { provide: InterfoneStore, useValue: store },
          { provide: ApartamentosApi, useValue: aptos },
        ],
      });
      const fixture = TestBed.createComponent(LigarUnidadeComponent);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      const input = el.querySelector('input') as HTMLInputElement;
      input.value = '101';
      input.dispatchEvent(new Event('input'));
      jest.advanceTimersByTime(300);
      fixture.detectChanges();
      expect(aptos.list).toHaveBeenCalledWith('101');
      const ligar = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Ligar')!;
      expect(el.textContent).toContain('Bloco A · Apto 101');
      ligar.click();
      expect(store.ligar).toHaveBeenCalledWith(10, 'Bloco A · Apto 101');

      store.emChamada.set({ id: 1 });
      fixture.detectChanges();
      expect(ligar.disabled).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  function montarSemBusca(hoje = HOJE) {
    const store = storeFalso();
    store.hoje.set(hoje);
    TestBed.configureTestingModule({
      imports: [LigarUnidadeComponent],
      providers: [
        { provide: InterfoneStore, useValue: store },
        { provide: ApartamentosApi, useValue: { list: jest.fn(() => of([])) } },
      ],
    });
    const fixture = TestBed.createComponent(LigarUnidadeComponent);
    fixture.detectChanges();
    return { fixture, store, el: fixture.nativeElement as HTMLElement };
  }

  it('busca vazia mostra as unidades mais chamadas hoje e liga com um clique', () => {
    const { el, store, fixture } = montarSemBusca([
      { ...HOJE[0], id: 1 },
      { ...HOJE[0], id: 2 },
      { ...HOJE[0], id: 3, unidade: 'Bloco B · Apto 201', id_apartamento: 200 },
    ]);
    const sec = el.querySelector('[data-teste="frequentes"]') as HTMLElement;
    expect(sec.textContent).toContain('Mais chamadas hoje');
    expect(sec.textContent).toContain('2 chamadas');
    expect(sec.textContent).toContain('1 chamada');
    (sec.querySelector('button') as HTMLButtonElement).click();
    expect(store.ligar).toHaveBeenCalledWith(100, 'Bloco A · Apto 106');

    const input = el.querySelector('input') as HTMLInputElement;
    input.value = '10';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelector('[data-teste="frequentes"]')).toBeNull();
  });

  it('sem chamadas hoje mostra a dica de busca', () => {
    const { el } = montarSemBusca([]);
    expect(el.querySelector('[data-teste="frequentes"]')).toBeNull();
    expect(el.querySelector('[data-teste="dica-ligar"]')?.textContent).toContain('Digite o bloco');
  });
});
