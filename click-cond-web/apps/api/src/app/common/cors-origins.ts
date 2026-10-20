export const CORS_ORIGINS_PRINCIPAIS = [
  'https://clickprestarecondominios.com.br',
  'https://www.clickprestarecondominios.com.br',
  'https://prestarecondominios.com.br',
  'https://www.prestarecondominios.com.br',
  'https://main.d340ziyanv9pav.amplifyapp.com',
  'http://localhost:5173',
  'http://localhost:4200',
  'http://localhost:3000',
];

/**
 * Origens que recebem CORS com credenciais: as principais mais as de
 * CORS_ORIGINS (env do Beanstalk). `.vercel.app` é descartado — a Vercel foi
 * desativada e domínio abandonado lá pode ser registrado por terceiros.
 * Usado pelo main.ts e pelo filtro de exceções, para que a resposta de erro
 * não confie em quem a resposta de sucesso não confia.
 */
export function origensConfiaveis(): string[] {
  const extras = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean)
    .filter((o) => !/\.vercel\.app$/i.test(o));
  return [...new Set([...CORS_ORIGINS_PRINCIPAIS, ...extras])];
}

export function origemConfiavel(origin: string): boolean {
  return origensConfiaveis().includes(origin);
}

/** Webhooks e simuladores de dispositivo: qualquer origem, sem credenciais. */
export const ROTAS_HARDWARE = /^\/api\/facial\/(webhook|sim|simulator)\b/;
