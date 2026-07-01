import { Component, inject, signal, computed, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../auth/auth.service';

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
  readonly isLight = signal<boolean>(false);
  @Output() linkClicked = new EventEmitter<void>();

  readonly isPorteiro = computed(() => {
    const info = this.auth.porteiroInfo();
    if (!info) return false;
    return !!info.turno && info.turno !== 'Síndico';
  });

  constructor() {
    const saved = localStorage.getItem('theme_mode');
    if (saved === 'light') {
      this.isLight.set(true);
      document.body.classList.add('light');
      document.documentElement.classList.add('light');
      document.body.classList.remove('dark');
      document.documentElement.classList.remove('dark');
    } else {
      this.isLight.set(false);
      document.body.classList.remove('light');
      document.documentElement.classList.remove('light');
      document.body.classList.add('dark');
      document.documentElement.classList.add('dark');
    }
  }

  toggleTheme() {
    if (this.isLight()) {
      this.isLight.set(false);
      localStorage.setItem('theme_mode', 'dark');
      document.body.classList.remove('light');
      document.documentElement.classList.remove('light');
      document.body.classList.add('dark');
      document.documentElement.classList.add('dark');
    } else {
      this.isLight.set(true);
      localStorage.setItem('theme_mode', 'light');
      document.body.classList.add('light');
      document.documentElement.classList.add('light');
      document.body.classList.remove('dark');
      document.documentElement.classList.remove('dark');
    }
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
        { label: 'Prestadores de Serviço', path: '/prestadores', icon: '✦' },
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