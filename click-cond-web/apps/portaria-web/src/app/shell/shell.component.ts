import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SidebarComponent } from './sidebar.component';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, SidebarComponent],
  template: `
    <div class="app-bg flex flex-col min-[900px]:flex-row overflow-x-hidden min-h-screen min-[900px]:h-screen min-[900px]:overflow-hidden">
      <!-- Topbar mobile -->
      <header class="min-[900px]:hidden sticky top-0 z-30 flex items-center justify-between px-4 py-3 bg-[var(--bg-000)] border-b border-[var(--line-100)] select-none">
        <div class="ps-brand !gap-2.5">
          <img src="/prestare-marca-branca.svg" alt="Prestare Gestão" class="ps-logo-dark !h-7" />
          <img src="/prestare-marca-preta.svg" alt="Prestare Gestão" class="ps-logo-light !h-7" />
          <span class="ps-brand-wm !text-[15px]">Prestare<span> Gestão</span></span>
        </div>
        <button
          type="button"
          class="ps-ibtn"
          (click)="isSidebarOpen.set(!isSidebarOpen())"
          [attr.aria-label]="isSidebarOpen() ? 'Fechar menu' : 'Abrir menu'"
        >
          @if (isSidebarOpen()) {
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          } @else {
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16"/>
            </svg>
          }
        </button>
      </header>

      <!-- Escurecimento atrás do menu (somente mobile) -->
      <div
        class="ps-scrim min-[900px]:!hidden"
        [class.on]="isSidebarOpen()"
        (click)="isSidebarOpen.set(false)"
      ></div>

      <!-- Sidebar: painel deslizante no mobile, coluna fixa de 248px no desktop -->
      <div
        class="fixed min-[900px]:static inset-y-0 left-0 w-[272px] min-[900px]:w-[248px] shrink-0 z-[55] min-[900px]:z-auto
               transition-transform duration-[350ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]
               min-[900px]:translate-x-0"
        [class.-translate-x-full]="!isSidebarOpen()"
        [class.translate-x-0]="isSidebarOpen()"
      >
        <app-sidebar (linkClicked)="isSidebarOpen.set(false)" />
      </div>

      <!-- Conteúdo: único elemento que rola no desktop (sidebar fica fixa) -->
      <main class="flex-1 min-w-0 min-[900px]:h-screen min-[900px]:overflow-y-auto">
        <router-outlet />
      </main>
    </div>
  `,
})
export class ShellComponent {
  readonly isSidebarOpen = signal(false);
}

