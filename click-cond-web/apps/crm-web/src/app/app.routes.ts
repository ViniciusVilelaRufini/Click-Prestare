import { Route } from '@angular/router';
import { authGuard } from './auth/auth.guard';

export const appRoutes: Route[] = [
  {
    path: 'login',
    loadComponent: () =>
      import('./auth/login-page.component').then((m) => m.LoginPageComponent),
  },
  {
    path: '',
    canActivate: [authGuard],
    canActivateChild: [authGuard],
    loadComponent: () =>
      import('./shell/shell.component').then((m) => m.ShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'painel' },
      {
        // Shell do CRM: navegação, status de conexão, drawer e toasts.
        // Cada aba é uma rota filha lazy — dá deep-link, preserva a aba no F5
        // e garante que os pollings de cada aba morram no ngOnDestroy.
        path: 'painel',
        loadComponent: () =>
          import('./crm/crm-page.component').then((m) => m.CrmPageComponent),
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'overview' },
          {
            path: 'overview',
            loadComponent: () => import('./crm/tabs/crm-overview.component').then((m) => m.CrmOverviewComponent),
          },
          {
            path: 'clientes',
            loadComponent: () => import('./crm/tabs/crm-clientes.component').then((m) => m.CrmClientesComponent),
          },
          {
            path: 'faturamento',
            loadComponent: () => import('./crm/tabs/crm-faturamento.component').then((m) => m.CrmFaturamentoComponent),
          },
          {
            path: 'automacoes',
            loadComponent: () => import('./crm/tabs/crm-automacoes.component').then((m) => m.CrmAutomacoesComponent),
          },
          {
            path: 'relatorios',
            loadComponent: () => import('./crm/tabs/crm-relatorios.component').then((m) => m.CrmRelatoriosComponent),
          },
          {
            path: 'chamados',
            loadComponent: () => import('./crm/tabs/crm-chamados.component').then((m) => m.CrmChamadosComponent),
          },
          {
            path: 'configuracoes',
            loadComponent: () => import('./crm/tabs/crm-configuracoes.component').then((m) => m.CrmConfiguracoesComponent),
          },
        ],
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
