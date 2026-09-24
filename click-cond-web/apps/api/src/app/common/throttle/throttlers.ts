/**
 * Throttlers globais da API.
 *
 * O override por rota é feito pelo NOME: `@Throttle({ medium: {...} })` e
 * `@SkipThrottle({ short: true, medium: true })`. A chave `default` não existe
 * aqui, e o ThrottlerGuard simplesmente ignora metadado de nome desconhecido.
 */
export const THROTTLERS = [
  {
    name: 'short',
    ttl: 1000,
    limit: 20, // 20 req/s por IP — protege contra burst
  },
  {
    name: 'medium',
    ttl: 60000,
    limit: 600, // 600 req/min por IP — uso normal do app
  },
];
