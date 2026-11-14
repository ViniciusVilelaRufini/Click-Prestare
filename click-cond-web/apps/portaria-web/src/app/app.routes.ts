import { inject } from '@angular/core';
import { CanMatchFn, Route, Router } from '@angular/router';
import { authGuard } from './auth/auth.guard';

const convitePorQueryCanMatch: CanMatchFn = () =>
  Boolean(inject(Router).getCurrentNavigation()?.extractedUrl.queryParams['convite']);

/**
 * Passe do visitante na raiz: `/#passe=<token>` (o link gerado — fragmento não
 * vai ao servidor nem a log de acesso), `/#passe` (a página tira o token da
 * barra e fica com a cópia da aba) e `/?passe=<token>` (links antigos).
 */
const passePorQueryCanMatch: CanMatchFn = () => {
  const url = inject(Router).getCurrentNavigation()?.extractedUrl;
  return Boolean(url?.queryParams['passe']) || /^passe(=|&|$)/.test(url?.fragment ?? '');
};

const redefinirSenhaPorQueryCanMatch: CanMatchFn = () => {
  const queryParams = inject(Router).getCurrentNavigation()?.extractedUrl.queryParams;
  return Boolean(
    queryParams &&
      (queryParams['redefinir-senha'] !== undefined ||
        queryParams['redefinir_senha'] !== undefined ||
        queryParams['token'] !== undefined),
  );
};

export const appRoutes: Route[] = [
  {
    // Fallback público via query param na raiz para contornar ausência de rewrite SPA no hosting (Amplify).
    path: '',
    pathMatch: 'full',
    canMatch: [redefinirSenhaPorQueryCanMatch],
    loadComponent: () =>
      import('./auth/redefinir-senha-page.component').then((m) => m.RedefinirSenhaPageComponent),
  },
  {
    // O fallback público usa a raiz para evitar deep link no hosting. Sem a
    // query, este caminho não casa e a rota raiz protegida abaixo continua
    // sendo responsável pelo console.
    path: '',
    pathMatch: 'full',
    canMatch: [convitePorQueryCanMatch],
    loadComponent: () =>
      import('./convite/convite-page.component').then((m) => m.ConvitePageComponent),
  },
  {
    // Passe do visitante (QR dinâmico), na raiz como o convite, porque o
    // Amplify não entrega caminho profundo ao SPA. O link que a API gera é
    // `/#passe=<token>`; ver passePorQueryCanMatch.
    path: '',
    pathMatch: 'full',
    canMatch: [passePorQueryCanMatch],
    loadComponent: () =>
      import('./passe/passe-page.component').then((m) => m.PassePageComponent),
  },
  {
    path: 'login',
    loadComponent: () =>
      import('./auth/login-page.component').then((m) => m.LoginPageComponent),
  },
  {
    // Pública: aberta pelo link enviado por e-mail para redefinir senha.
    path: 'redefinir-senha',
    loadComponent: () =>
      import('./auth/redefinir-senha-page.component').then((m) => m.RedefinirSenhaPageComponent),
  },
  {
    // Fora do shell: é uma tela cheia, mostrada antes de entrar no console.
    path: 'selecionar-condominio',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./auth/selecionar-condominio.component').then(
        (m) => m.SelecionarCondominioComponent,
      ),
  },
  {
    // Pública de propósito: é o link que o visitante abre pelo WhatsApp, sem
    // ter conta. A trava não é guard, é o token — 32 bytes aleatórios, de uso
    // único e validade de 24h.
    path: 'convite/:token',
    loadComponent: () =>
      import('./convite/convite-page.component').then((m) => m.ConvitePageComponent),
  },
  {
    // `/convite` sem token. Não é um caminho que o app gere, mas é o que
    // sobra quando alguém corta o link ao copiar do WhatsApp — e o app não
    // tem rota curinga, então sem isto a tela fica BRANCA, que é a pior
    // resposta possível: parece defeito e não diz nada.
    path: 'convite',
    loadComponent: () =>
      import('./convite/convite-page.component').then((m) => m.ConvitePageComponent),
  },
  {
    // Pública como o convite: a trava é o token do passe (HMAC do servidor,
    // trocado quando o morador cancela o link). Mantida para quando a
    // hospedagem servir caminho profundo; o link gerado hoje usa `#passe=`.
    path: 'passe/:token',
    loadComponent: () =>
      import('./passe/passe-page.component').then((m) => m.PassePageComponent),
  },
  {
    // Sem token: mesma tela de passe indisponível, em vez de tela branca.
    path: 'passe',
    loadComponent: () =>
      import('./passe/passe-page.component').then((m) => m.PassePageComponent),
  },
  {
    path: 'politica-de-privacidade',
    loadComponent: () =>
      import('./legal/politica-privacidade.component').then((m) => m.PoliticaPrivacidadeComponent),
  },
  {
    path: 'politica-privacidade',
    loadComponent: () =>
      import('./legal/politica-privacidade.component').then((m) => m.PoliticaPrivacidadeComponent),
  },
  {
    path: 'exclusao-de-conta',
    loadComponent: () =>
      import('./legal/exclusao-conta.component').then((m) => m.ExclusaoContaComponent),
  },
  {
    path: 'exclusao-conta',
    loadComponent: () =>
      import('./legal/exclusao-conta.component').then((m) => m.ExclusaoContaComponent),
  },
  {
    path: '',
    canActivate: [authGuard],
    canActivateChild: [authGuard],
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
        data: { modo: 'visitante' },
        loadComponent: () =>
          import('./visitantes/visitantes-page.component').then(
            (m) => m.VisitantesPageComponent,
          ),
      },
      {
        // Gestão de acesso de prestadores (mesma UI de Visitantes, is_prestador=1).
        path: 'prestadores',
        data: { modo: 'prestador' },
        loadComponent: () =>
          import('./visitantes/visitantes-page.component').then(
            (m) => m.VisitantesPageComponent,
          ),
      },
      {
        // Cadastro fixo de empresas/profissionais (Prestadores_servico).
        path: 'prestadores/cadastro',
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
        path: 'veiculos',
        loadComponent: () =>
          import('./veiculos/veiculos-page.component').then(
            (m) => m.VeiculosPageComponent,
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
        path: 'delivery',
        loadComponent: () =>
          import('./delivery/delivery-page.component').then(
            (m) => m.DeliveryPageComponent,
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
        path: 'terminais-faciais',
        loadComponent: () =>
          import('./terminais-faciais/terminais-faciais-page.component').then(
            (m) => m.TerminaisFaciaisPageComponent,
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
