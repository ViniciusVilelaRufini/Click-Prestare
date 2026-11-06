import { AfterViewInit, Directive, ElementRef, HostListener, Input, NgZone, OnChanges, OnDestroy, inject } from '@angular/core';

/**
 * Indicador sólido que desliza até o item ativo (sidebar e controle segmentado).
 *
 * Contrato de uso:
 *   <nav class="relative" [psSlideIndicator]="'y'">
 *     <span class="ps-slide-ind"></span>          <- elemento indicador (filho do host)
 *     <a routerLinkActive="on">...</a>            <- itens; o ativo tem a classe `on`
 *   </nav>
 *
 * - `psSlideIndicator`: eixo, 'y' (top/height) ou 'x' (left/width). Padrão 'y'.
 * - `psSlideItem`: seletor CSS do item ativo. Padrão `.on, [aria-current="page"]`.
 * - `psSlideInd`: seletor do indicador dentro do host. Padrão `.ps-slide-ind`.
 *
 * O host precisa de `position: relative`. O indicador precisa de `position: absolute`
 * e da própria transição CSS (a diretiva só escreve top/height ou left/width e a
 * opacidade; sem item ativo, opacidade 0).
 */
@Directive({
  selector: '[psSlideIndicator]',
  standalone: true,
})
export class SlideIndicatorDirective implements AfterViewInit, OnChanges, OnDestroy {
  @Input('psSlideIndicator') axis: 'x' | 'y' | '' = 'y';
  @Input() psSlideItem = '.on, [aria-current="page"]';
  @Input() psSlideInd = '.ps-slide-ind';

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly zone = inject(NgZone);
  private mutations?: MutationObserver;
  private resizes?: ResizeObserver;
  private pendente = false;
  private iniciado = false;

  ngAfterViewInit(): void {
    this.iniciado = true;
    this.zone.runOutsideAngular(() => {
      if (typeof MutationObserver !== 'undefined') {
        this.mutations = new MutationObserver(() => this.agendar());
        this.mutations.observe(this.host, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ['class', 'aria-current'],
        });
      }
      if (typeof ResizeObserver !== 'undefined') {
        this.resizes = new ResizeObserver(() => this.agendar());
        this.resizes.observe(this.host);
      }
    });
    this.agendar();
  }

  ngOnChanges(): void {
    if (this.iniciado) this.agendar();
  }

  ngOnDestroy(): void {
    this.mutations?.disconnect();
    this.resizes?.disconnect();
  }

  @HostListener('window:resize')
  onResize(): void {
    this.agendar();
  }

  // Agrupa mudanças do mesmo ciclo e mede depois que o layout assentou.
  private agendar(): void {
    if (this.pendente) return;
    this.pendente = true;
    setTimeout(() => {
      this.pendente = false;
      this.posicionar();
    });
  }

  private posicionar(): void {
    const ind = this.host.querySelector<HTMLElement>(this.psSlideInd);
    if (!ind) return;
    const item = this.host.querySelector<HTMLElement>(this.psSlideItem);
    if (!item) {
      ind.style.opacity = '0';
      return;
    }
    if (this.axis === 'x') {
      ind.style.left = `${item.offsetLeft}px`;
      ind.style.width = `${item.offsetWidth}px`;
    } else {
      ind.style.top = `${item.offsetTop}px`;
      ind.style.height = `${item.offsetHeight}px`;
    }
    ind.style.opacity = '1';
  }
}
