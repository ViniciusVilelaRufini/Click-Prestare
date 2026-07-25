import { Injectable, signal } from '@angular/core';

export type ToastTipo = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  message: string;
  tipo: ToastTipo;
}

/** Fila de toasts empilháveis com variantes (success/error/info). */
@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private seq = 0;

  trigger(message: string, tipo: ToastTipo = 'info'): void {
    const id = ++this.seq;
    this.toasts.update((list) => [...list, { id, message, tipo }]);
    setTimeout(() => this.dismiss(id), tipo === 'error' ? 5000 : 3200);
  }

  dismiss(id: number): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }
}
