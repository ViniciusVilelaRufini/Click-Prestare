import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Casca padronizada de modal: backdrop com blur + painel com animação de
 * entrada (scale-in). Fecha em Esc e em clique no backdrop.
 * O conteúdo vem por <ng-content>; o painel usa a largura de `maxWidth`.
 *
 * Uso:
 *   @if (aberto()) {
 *     <app-modal-shell maxWidth="max-w-2xl" ariaLabel="Detalhe da fatura" (fechar)="fechar()">
 *       ...conteúdo...
 *     </app-modal-shell>
 *   }
 */
@Component({
  selector: 'app-modal-shell',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-surface-overlay p-4 backdrop-blur-sm animate-fade-in"
      (click)="onBackdrop($event)"
    >
      <div
        class="card w-full shadow-modal animate-scale-in max-h-[90vh] overflow-y-auto {{ maxWidth }}"
        role="dialog"
        aria-modal="true"
        [attr.aria-label]="ariaLabel"
      >
        <ng-content />
      </div>
    </div>
  `,
})
export class ModalShellComponent {
  @Input() maxWidth = 'max-w-2xl';
  @Input() ariaLabel = '';
  @Output() fechar = new EventEmitter<void>();

  @HostListener('document:keydown.escape')
  onEsc(): void {
    this.fechar.emit();
  }

  onBackdrop(e: MouseEvent): void {
    if (e.target === e.currentTarget) this.fechar.emit();
  }
}
