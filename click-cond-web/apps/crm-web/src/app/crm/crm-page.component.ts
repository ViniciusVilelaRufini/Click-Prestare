import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { CrmStore } from './crm.store';
import { AuthService } from '../auth/auth.service';
import { ClienteDrawerComponent } from './cliente/cliente-drawer.component';
import { ToastContainerComponent } from '../shared/ui/toast-container.component';
import { SkeletonComponent } from '../shared/ui/skeleton.component';
import { iniciais } from './crm-format';

interface ItemNav {
  rota: string;
  label: string;
  labelCurto: string;
  icone: string;
}

/**
 * Shell do painel do CRM (layout "Verdant"): cabeçalho com saudação, busca
 * global e ações circulares; rail de ícones flutuante no desktop e barra de
 * pílulas rolável no mobile. Também hospeda o drawer de cliente e os toasts.
 * Cada aba é uma rota filha lazy sob /painel — ver app.routes.ts.
 * O estado compartilhado entre abas vive no CrmStore.
 */
@Component({
  selector: 'app-crm-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    ClienteDrawerComponent,
    ToastContainerComponent,
    SkeletonComponent,
  ],
  templateUrl: './crm-page.component.html',
})
export class CrmPageComponent implements OnInit, OnDestroy {
  readonly auth = inject(AuthService);
  readonly store = inject(CrmStore);
  private readonly router = inject(Router);

  readonly iniciais = iniciais;

  /** Termo digitado na busca global do cabeçalho. */
  readonly termoBusca = signal('');

  /** Primeiro nome do admin logado — usado na saudação. */
  readonly primeiroNome = computed(
    () => (this.auth.adminInfo()?.nome || 'Gestor').trim().split(/\s+/)[0],
  );

  /** Quantidade de sinais no radar de risco (ponto vermelho do sino). */
  readonly totalAlertas = computed(() => this.store.overview()?.alertas?.length ?? 0);

  /** Itens de navegação (mesma fonte para sidebar e barra mobile). */
  readonly navItens: ItemNav[] = [
    {
      rota: 'overview',
      label: 'Visão geral',
      labelCurto: 'Visão geral',
      icone: 'M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z',
    },
    {
      rota: 'clientes',
      label: 'Clientes',
      labelCurto: 'Clientes',
      icone: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
    },
    {
      rota: 'faturamento',
      label: 'Faturamento',
      labelCurto: 'Faturamento',
      icone: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z',
    },
    {
      rota: 'automacoes',
      label: 'Automações',
      labelCurto: 'Automações',
      icone: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
    },
    {
      rota: 'relatorios',
      label: 'Relatórios',
      labelCurto: 'Relatórios',
      icone: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    },
    {
      rota: 'chamados',
      label: 'Chamados',
      labelCurto: 'Chamados',
      icone: 'M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z',
    },
    {
      rota: 'superlogica',
      label: 'Superlógica',
      labelCurto: 'Superlógica',
      icone: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
    },
    {
      rota: 'configuracoes',
      label: 'Configurações',
      labelCurto: 'Config.',
      icone: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z',
    },
  ];

  ngOnInit(): void {
    this.store.carregarTudo();
    this.store.iniciarHealthPolling();
  }

  ngOnDestroy(): void {
    this.store.pararHealthPolling();
  }

  carregar(): void {
    this.store.carregar();
  }

  verificarConexao(): void {
    this.store.verificarConexao();
  }

  /** Busca global: publica o termo no store e leva para o diretório de clientes. */
  buscar(): void {
    this.store.buscaGlobal.set(this.termoBusca().trim());
    this.store.fecharCliente();
    this.router.navigate(['/painel/clientes']);
  }

  /** Trocar de aba fecha o drawer para não sobrepor a nova tela. */
  onTrocarAba(): void {
    this.store.fecharCliente();
  }
}
