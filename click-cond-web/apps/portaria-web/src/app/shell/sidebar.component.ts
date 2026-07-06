import { Component, inject, computed, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { ThemeService } from '../shared/theme.service';

interface NavItem {
  label: string;
  path: string;
  icon: string;
}

interface NavGroup {
  category: string;
  items: NavItem[];
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  templateUrl: './sidebar.component.html',
})
export class SidebarComponent {
  readonly auth = inject(AuthService);
  private theme = inject(ThemeService);
  readonly isLight = this.theme.isLight;
  @Output() linkClicked = new EventEmitter<void>();

  readonly isPorteiro = computed(() => {
    const info = this.auth.porteiroInfo();
    if (!info) return false;
    return !!info.turno && info.turno !== 'Síndico';
  });

  toggleTheme() {
    this.theme.toggleTheme();
  }


  readonly menu: NavGroup[] = [
    {
      category: 'Principal',
      items: [
        { label: 'Dashboard', path: '/dashboard', icon: '◉' }
      ]
    },
    {
      category: 'Operação',
      items: [
        { label: 'Visitantes', path: '/visitantes', icon: '◆' },
        { label: 'Prestadores', path: '/prestadores', icon: '✦' },
        { label: 'Encomendas', path: '/encomendas', icon: '⬚' },
        { label: 'Ocorrências', path: '/ocorrencias', icon: '!' }
      ]
    },
    {
      category: 'Gestão',
      items: [
        { label: 'Moradores', path: '/moradores', icon: '✪' },
        { label: 'Apartamentos', path: '/apartamentos', icon: '▣' },
        { label: 'Funcionários', path: '/prestadores/cadastro', icon: '✦' }
      ]
    },
    {
      category: 'Serviços',
      items: [
        { label: 'Comunicados', path: '/comunicados', icon: '✉' },
        { label: 'Áreas Sociais', path: '/areas-sociais', icon: '☕' },
        { label: 'Assembleias', path: '/assembleias', icon: '⚖' }
      ]
    },
    {
      category: 'Administrativo',
      items: [
        { label: 'Financeiro', path: '/financeiro', icon: '💲' },
        { label: 'Documentos', path: '/documentos', icon: '📄' },
        { label: 'Relatórios', path: '/relatorios', icon: '📊' },
        { label: 'Configurações', path: '/configuracoes', icon: '⚙' }
      ]
    }
  ];
}