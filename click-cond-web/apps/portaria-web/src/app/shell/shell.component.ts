import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SidebarComponent } from './sidebar.component';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, SidebarComponent],
  template: `
    <div
      class="app-bg flex flex-col md:flex-row overflow-x-hidden min-h-screen md:h-screen md:overflow-hidden"
    >
      <!-- Top Navbar for Mobile -->
      <header class="md:hidden flex items-center justify-between px-4 py-3 bg-slate-100 dark:bg-graphite-200 border-b border-slate-200 dark:border-white/5 select-none z-30 relative">
        <div class="flex items-center gap-2">
          <div class="w-9 h-9 rounded-lg bg-white p-0.5 flex items-center justify-center
                      ring-1 ring-accent/10 shadow-sm shadow-accent/15 shrink-0">
            <img src="/logo-prestare-gestao.png" alt="Prestare Gestão"
                 class="w-full h-full object-cover rounded-md" />
          </div>
          <!-- Era text-white sobre bg-slate-100: sumia no tema claro. -->
          <span class="font-display text-sm font-extrabold uppercase tracking-tight text-slate-900 dark:text-slate-100">
            Prestare<span class="text-accent"> Gestão</span>
          </span>
        </div>
        <button
          (click)="isSidebarOpen.set(!isSidebarOpen())"
          class="p-2 rounded-lg text-slate-400 hover:bg-white/5 transition"
          [attr.aria-label]="isSidebarOpen() ? 'Fechar menu' : 'Abrir menu'"
        >
          <!-- Hamburger / Close icon -->
          @if (isSidebarOpen()) {
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          } @else {
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/>
            </svg>
          }
        </button>
      </header>

      <!-- Backdrop overlay -->
      <div
        class="md:hidden fixed inset-0 bg-black/60 z-40 transition-opacity duration-300"
        [class.opacity-0]="!isSidebarOpen()"
        [class.opacity-100]="isSidebarOpen()"
        [class.pointer-events-none]="!isSidebarOpen()"
        (click)="isSidebarOpen.set(false)"
      ></div>

      <!-- Sidebar — fixed on mobile (slides in/out), static on desktop -->
      <div
        class="fixed md:static inset-y-0 left-0 w-72 md:w-64 z-50 md:z-auto
               transition-transform duration-300 ease-in-out
               md:translate-x-0"
        [class.-translate-x-full]="!isSidebarOpen()"
        [class.translate-x-0]="isSidebarOpen()"
      >
        <app-sidebar (linkClicked)="isSidebarOpen.set(false)" />
      </div>

      <!-- Main content — único elemento que rola no desktop (sidebar fica fixa) -->
      <main class="flex-1 min-w-0 md:h-screen md:overflow-y-auto">
        <router-outlet />
      </main>
    </div>
  `,
})
export class ShellComponent {
  readonly isSidebarOpen = signal(false);
}

