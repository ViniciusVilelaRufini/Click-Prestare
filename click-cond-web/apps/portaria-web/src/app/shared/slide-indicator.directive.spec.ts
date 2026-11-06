import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SlideIndicatorDirective } from './slide-indicator.directive';

@Component({
  standalone: true,
  imports: [SlideIndicatorDirective],
  template: `
    <div id="host" [psSlideIndicator]="axis()" [psSlideItem]="seletor()">
      <span class="ps-slide-ind"></span>
      <a id="a" [class.on]="ativo() === 'a'">A</a>
      <a id="b" [class.on]="ativo() === 'b'" [attr.aria-current]="ativo() === 'b' ? 'page' : null">B</a>
    </div>
  `,
})
class HostComponent {
  axis = signal<'x' | 'y'>('y');
  seletor = signal('.on');
  ativo = signal<'a' | 'b' | null>('a');
}

function medidas(el: HTMLElement, top: number, left: number, w: number, h: number) {
  Object.defineProperty(el, 'offsetTop', { value: top, configurable: true });
  Object.defineProperty(el, 'offsetLeft', { value: left, configurable: true });
  Object.defineProperty(el, 'offsetWidth', { value: w, configurable: true });
  Object.defineProperty(el, 'offsetHeight', { value: h, configurable: true });
}

describe('psSlideIndicator', () => {
  let fixture: ComponentFixture<HostComponent>;
  let ind: HTMLElement;

  const tick = () => new Promise<void>((r) => setTimeout(r, 10));

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    const root: HTMLElement = fixture.nativeElement;
    medidas(root.querySelector('#a')!, 10, 5, 100, 34);
    medidas(root.querySelector('#b')!, 44, 105, 80, 34);
    ind = root.querySelector('.ps-slide-ind')!;
    fixture.detectChanges();
  });

  it('eixo y: posiciona o indicador no item ativo (top e height)', async () => {
    await tick();
    expect(ind.style.top).toBe('10px');
    expect(ind.style.height).toBe('34px');
    expect(ind.style.opacity).toBe('1');
  });

  it('reposiciona quando o item ativo muda', async () => {
    await tick();
    fixture.componentInstance.ativo.set('b');
    fixture.detectChanges();
    await tick();
    expect(ind.style.top).toBe('44px');
  });

  it('eixo x: usa left e width', async () => {
    fixture.componentInstance.axis.set('x');
    fixture.componentInstance.ativo.set('b');
    fixture.detectChanges();
    await tick();
    expect(ind.style.left).toBe('105px');
    expect(ind.style.width).toBe('80px');
  });

  it('aceita seletor configuravel (aria-current)', async () => {
    fixture.componentInstance.seletor.set('[aria-current]');
    fixture.componentInstance.ativo.set('b');
    fixture.detectChanges();
    await tick();
    expect(ind.style.top).toBe('44px');
  });

  it('esconde o indicador quando nenhum item esta ativo', async () => {
    fixture.componentInstance.ativo.set(null);
    fixture.detectChanges();
    await tick();
    expect(ind.style.opacity).toBe('0');
  });

  it('reposiciona no resize da janela', async () => {
    await tick();
    medidas(fixture.nativeElement.querySelector('#a'), 20, 5, 100, 40);
    window.dispatchEvent(new Event('resize'));
    await tick();
    expect(ind.style.top).toBe('20px');
    expect(ind.style.height).toBe('40px');
  });
});
