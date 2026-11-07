import { Component, inject, computed, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { ehPorteiro } from '../auth/papel';
import { ThemeService } from '../shared/theme.service';
import { SlideIndicatorDirective } from '../shared/slide-indicator.directive';

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
  imports: [CommonModule, RouterLink, RouterLinkActive, SlideIndicatorDirective],
  templateUrl: './sidebar.component.html',
  styles: [`
    .ps-nav-grp {
      margin: 14px 0 6px;
      padding: 0 12px;
    }
    .ps-nav-grp:first-of-type {
      margin-top: 4px;
    }
    .ps-nav-item {
      position: relative;
      z-index: 1;
      display: flex;
      align-items: center;
      gap: 12px;
      height: 34px;
      padding: 0 12px;
      font-size: 14px;
      color: var(--ink-muted);
      transition: color 0.2s;
    }
    .ps-nav-item:hover {
      color: var(--ink);
    }
    .ps-nav-item.on {
      color: var(--on-brand);
    }
    .ps-nav-svg {
      width: 17px;
      height: 17px;
    }
    .ps-slide-ind {
      position: absolute;
      left: 0;
      right: 0;
      top: 0;
      height: 34px;
      opacity: 0;
      background: var(--brand);
      z-index: 0;
      transition: top 0.32s cubic-bezier(0.2, 0.8, 0.2, 1), height 0.32s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.2s;
    }
  `],
})
export class SidebarComponent {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private theme = inject(ThemeService);
  readonly isLight = this.theme.isLight;
  @Output() linkClicked = new EventEmitter<void>();

  readonly isPorteiro = computed(() => ehPorteiro(this.auth.porteiroInfo()));

  toggleTheme() {
    this.theme.toggleTheme();
  }

  /** Abre a escolha de condomínio (síndico com mais de um vínculo). */
  trocarCondominio() {
    this.linkClicked.emit();
    this.router.navigate(['/selecionar-condominio']);
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
        { label: 'Delivery', path: '/delivery', icon: 'D' },
        { label: 'Ocorrências', path: '/ocorrencias', icon: '!' }
      ]
    },
    {
      category: 'Gestão',
      items: [
        { label: 'Moradores', path: '/moradores', icon: '✪' },
        { label: 'Apartamentos', path: '/apartamentos', icon: '▣' },
        { label: 'Veículos', path: '/veiculos', icon: '▤' },
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
