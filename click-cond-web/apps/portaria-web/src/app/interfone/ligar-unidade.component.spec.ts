import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { ApartamentosApi } from '../apartamentos/apartamentos.service';
import { ChamadasHojeComponent } from './chamadas-hoje.component';
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
});

describe('ChamadasHojeComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('lista tipo, resultado, quem atendeu e o portão aberto', () => {
    TestBed.configureTestingModule({
      imports: [ChamadasHojeComponent],
      providers: [{ provide: InterfoneStore, useValue: storeFalso() }],
    });
    const fixture = TestBed.createComponent(ChamadasHojeComponent);
    fixture.detectChanges();
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Bloco A · Apto 106');
    expect(texto).toContain('Portão → unidade');
    expect(texto).toContain('Atendida pelo morador');
    expect(texto).toContain('Ana Souza');
    expect(texto).toContain('Portão aberto');
  });

  it('sem chamadas', () => {
    const store = storeFalso();
    store.hoje.set([]);
    TestBed.configureTestingModule({
      imports: [ChamadasHojeComponent],
      providers: [{ provide: InterfoneStore, useValue: store }],
    });
    const fixture = TestBed.createComponent(ChamadasHojeComponent);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Nenhuma chamada hoje.');
  });
});
