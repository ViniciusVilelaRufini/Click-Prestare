import { Directive, ElementRef, Input, OnChanges, SimpleChanges, inject } from '@angular/core';

type CountFormat = 'moeda' | 'int' | 'pct';

/**
 * Anima o número exibido de um valor anterior até o alvo (count-up).
 * Uso: <span [countUp]="ov.mrrTotal" countUpFormat="moeda"></span>
 * Respeita prefers-reduced-motion (mostra o valor final direto).
 */
@Directive({
  selector: '[countUp]',
  standalone: true,
})
export class CountUpDirective implements OnChanges {
  private el = inject(ElementRef<HTMLElement>);

  @Input('countUp') value = 0;
  @Input('countUpFormat') format: CountFormat = 'int';
  @Input('countUpDuration') duration = 900;

  private current = 0;
  private raf = 0;

  ngOnChanges(changes: SimpleChanges): void {
    const target = Number(this.value) || 0;
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (changes['value']?.firstChange && reduce) {
      this.render(target);
      this.current = target;
      return;
    }
    if (reduce) {
      this.render(target);
      this.current = target;
      return;
    }
    this.animate(this.current, target);
  }

  private animate(from: number, to: number): void {
    cancelAnimationFrame(this.raf);
    const start = performance.now();
    const dur = this.duration;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3); // easeOutCubic

    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / dur);
      const v = from + (to - from) * ease(p);
      this.render(v);
      if (p < 1) {
        this.raf = requestAnimationFrame(tick);
      } else {
        this.current = to;
      }
    };
    this.raf = requestAnimationFrame(tick);
  }

  private render(v: number): void {
    let text: string;
    switch (this.format) {
      case 'moeda':
        text = Math.round(v).toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL',
          maximumFractionDigits: 0,
        });
        break;
      case 'pct':
        text = `${Math.round(v)}%`;
        break;
      default:
        text = Math.round(v).toLocaleString('pt-BR');
    }
    this.el.nativeElement.textContent = text;
  }
}
