import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';

/**
 * Shell mínimo: apenas o wrapper do router-outlet.
 * A chrome (branding, perfil admin, logout, navegação) vive numa sidebar
 * única dentro do CrmPageComponent — ver crm-page.component.html.
 */
@Component({
  selector: 'app-crm-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet],
  template: `
    <div class="min-h-screen bg-graphite text-slate-100">
      <router-outlet></router-outlet>
    </div>
  `,
})
export class ShellComponent {}
