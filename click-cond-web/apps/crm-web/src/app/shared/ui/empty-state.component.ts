import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

export type EmptyStateIcone = 'inbox' | 'busca' | 'fatura' | 'chat' | 'pessoas' | 'check' | 'raio' | 'grafico';

/**
 * Estado vazio padronizado: ícone + título + descrição + CTA opcional.
 * Uso: <app-empty-state icone="busca" titulo="Nenhum condomínio encontrado"
 *        descricao="Ajuste os filtros ou o termo de busca."
 *        ctaLabel="Limpar filtros" (cta)="limpar()" />
 */
@Component({
  selector: 'app-empty-state',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center animate-fade-in">
      <div class="flex h-12 w-12 items-center justify-center rounded-full bg-surface-sunken text-ink-muted">
        <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          @switch (icone) {
            @case ('busca') {
              <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
            }
            @case ('fatura') {
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6M7 3h10a2 2 0 012 2v16l-3-2-2 2-2-2-2 2-2-2-3 2V5a2 2 0 012-2z" />
            }
            @case ('chat') {
              <path stroke-linecap="round" stroke-linejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M21 12a8.96 8.96 0 01-9 9 8.96 8.96 0 01-4.4-1.15L3 21l1.15-4.6A8.96 8.96 0 013 12a9 9 0 1118 0z" />
            }
            @case ('pessoas') {
              <path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-6.9M15 7a4 4 0 11-8 0 4 4 0 018 0z" />
            }
            @case ('check') {
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            }
            @case ('raio') {
              <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            }
            @case ('grafico') {
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 3v18h18M9 17V9m4 8V5m4 12v-6" />
            }
            @default {
              <path stroke-linecap="round" stroke-linejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-5l-2 2h-2l-2-2H4" />
            }
          }
        </svg>
      </div>
      <div>
        <p class="text-sm font-semibold text-ink">{{ titulo }}</p>
        @if (descricao) {
          <p class="mt-1 text-sm text-ink-soft">{{ descricao }}</p>
        }
      </div>
      @if (ctaLabel) {
        <button type="button" class="btn-secondary press mt-1" (click)="cta.emit()">{{ ctaLabel }}</button>
      }
    </div>
  `,
})
export class EmptyStateComponent {
  @Input() icone: EmptyStateIcone = 'inbox';
  @Input({ required: true }) titulo = '';
  @Input() descricao = '';
  @Input() ctaLabel = '';
  @Output() cta = new EventEmitter<void>();
}
