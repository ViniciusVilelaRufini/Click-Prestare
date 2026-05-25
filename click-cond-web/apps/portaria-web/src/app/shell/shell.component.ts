import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SidebarComponent } from './sidebar.component';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, SidebarComponent],
  template: `
    <div class="app-bg min-h-screen flex flex-col md:flex-row">
      <!-- Top Navbar for Mobile/Tablet -->
      <header class="md:hidden flex items-center justify-between px-4 py-3 bg-white dark:bg-graphite-200 border-b border-slate-200/80 dark:border-white/5 select-none">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-lg bg-gradient-to-tr from-accent to-accent/80 flex items-center justify-center shrink-0">
            <svg class="w-4.5 h-4.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/>
            </svg>
          </div>
          <span class="font-display text-sm font-bold text-slate-900 dark:text-slate-100">Click Portaria</span>
        </div>
        <button (click)="isSidebarOpen.set(!isSidebarOpen())" class="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 transition">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/>
          </svg>
        </button>
      </header>

      <!-- Sidebar backdrop overlay on mobile -->
      <div
        *ngIf="isSidebarOpen()"
        (click)="isSidebarOpen.set(false)"
        class="md:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
      ></div>

      <!-- Sidebar container with responsive slide/position -->
      <div
        class="fixed md:static inset-y-0 left-0 w-64 z-50 md:z-auto transition-transform duration-300 md:translate-x-0"
        [class.-translate-x-full]="!isSidebarOpen()"
        [class.translate-x-0]="isSidebarOpen()"
      >
        <app-sidebar (linkClicked)="isSidebarOpen.set(false)" />
      </div>

      <main class="flex-1 min-w-0">
        <router-outlet />
      </main>
    </div>
  `,
})
export class ShellComponent {
  readonly isSidebarOpen = signal(false);
}
