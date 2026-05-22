import { Route } from '@angular/router';
import { authGuard } from './auth/auth.guard';

export const appRoutes: Route[] = [
  {
    path: 'login',
    loadComponent: () =>
      import('./auth/login-page.component').then((m) => m.LoginPageComponent),
  },
  {
    path: 'politica-de-privacidade',
    loadComponent: () =>
      import('./legal/politica-privacidade.component').then((m) => m.PoliticaPrivacidadeComponent),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./shell/shell.component').then((m) => m.ShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./dashboard/dashboard-page.component').then(
            (m) => m.DashboardPageComponent,
          ),
      },
      {
        path: 'visitantes',
        loadComponent: () =>
          import('./visitantes/visitantes-page.component').then(
            (m) => m.VisitantesPageComponent,
          ),
      },
      {
        path: 'prestadores',
        loadComponent: () =>
          import('./prestadores/prestadores-page.component').then(
            (m) => m.PrestadoresPageComponent,
          ),
      },
      {
        path: 'moradores',
        loadComponent: () =>
          import('./moradores/moradores-page.component').then(
            (m) => m.MoradoresPageComponent,
          ),
      },
      {
        path: 'apartamentos',
        loadComponent: () =>
          import('./apartamentos/apartamentos-page.component').then(
            (m) => m.ApartamentosPageComponent,
          ),
      },
      {
        path: 'ocorrencias',
        loadComponent: () =>
          import('./ocorrencias/ocorrencias-page.component').then(
            (m) => m.OcorrenciasPageComponent,
          ),
      },
      {
        path: 'comunicados',
        loadComponent: () =>
          import('./comunicados/comunicados-page.component').then(
            (m) => m.ComunicadosPageComponent,
          ),
      },
      {
        path: 'encomendas',
        loadComponent: () =>
          import('./encomendas/encomendas-page.component').then(
            (m) => m.EncomendasPageComponent,
          ),
      },
      {
        path: 'areas-sociais',
        loadComponent: () =>
          import('./areas-sociais/areas-sociais-page.component').then(
            (m) => m.AreasSociaisPageComponent,
          ),
      },
      {
        path: 'assembleias',
        loadComponent: () =>
          import('./assembleias/assembleias-page.component').then(
            (m) => m.AssembleiasPageComponent,
          ),
      },
      {
        path: 'financeiro',
        loadComponent: () =>
          import('./financeiro/financeiro-page.component').then(
            (m) => m.FinanceiroPageComponent,
          ),
      },
      {
        path: 'documentos',
        loadComponent: () =>
          import('./documentos/documentos-page.component').then(
            (m) => m.DocumentosPageComponent,
          ),
      },
      {
        path: 'configuracoes',
        loadComponent: () =>
          import('./configuracoes/configuracoes-page.component').then(
            (m) => m.ConfiguracoesPageComponent,
          ),
      },
      {
        path: 'relatorios',
        loadComponent: () =>
          import('./relatorios/relatorios-page.component').then(
            (m) => m.RelatoriosPageComponent,
          ),
      },
    ],
  },
];