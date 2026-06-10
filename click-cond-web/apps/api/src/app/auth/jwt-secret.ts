/**
 * Resolve o segredo do JWT a partir do ambiente.
 *
 * Diferente do antigo `process.env['JWT_SECRET'] ?? 'fallback-secret'`, aqui
 * NÃO há fallback embutido: se a env não estiver definida em produção, o
 * processo aborta no boot. Sem isso, uma env ausente fazia o sistema subir
 * com um segredo público conhecido — qualquer um forjava tokens válidos.
 *
 * Em ambiente de teste (NODE_ENV=test) usamos um segredo fixo só para os
 * testes rodarem sem configuração extra.
 */
export function resolveJwtSecret(): string {
  const secret = process.env['JWT_SECRET'];
  if (secret && secret.trim().length > 0) {
    return secret;
  }
  if (process.env['NODE_ENV'] === 'test') {
    return 'test-only-secret';
  }
  throw new Error(
    'JWT_SECRET não está definido. Configure a variável de ambiente antes de iniciar a API.',
  );
}
