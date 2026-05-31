import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SidebarComponent } from './sidebar.component';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, SidebarComponent],
  template: `
    <div class="app-bg min-h-screen flex flex-col md:flex-row overflow-x-hidden">
      <!-- Top Navbar for Mobile -->
      <header class="md:hidden flex items-center justify-between px-4 py-3 bg-graphite-200 border-b border-white/5 select-none z-30 relative">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-lg bg-gradient-to-tr from-accent to-accent/80 flex items-center justify-center shrink-0">
            <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/>
            </svg>
          </div>
          <span class="font-display text-sm font-bold text-white">Click Portaria</span>
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

      <!-- Main content -->
      <main class="flex-1 min-w-0">
        <router-outlet />
      </main>
    </div>
  `,
})
export class ShellComponent {
  readonly isSidebarOpen = signal(false);
}

