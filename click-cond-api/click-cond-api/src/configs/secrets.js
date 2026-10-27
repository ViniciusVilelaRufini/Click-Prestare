/**
 * Lê um segredo obrigatório do ambiente (JWT_SECRET, SESSION_SECRET).
 *
 * Sem fallback embutido: antes, uma env ausente fazia a API legada subir
 * assinando/verificando token com um literal que está no repositório —
 * qualquer um forjava sessão de qualquer usuário no banco para onde a
 * instância aponta (e o .env de desenvolvimento aponta para o RDS de
 * produção). Mesmo critério do resolveJwtSecret da API NestJS
 * (click-cond-web/apps/api/src/app/auth/jwt-secret.ts): sem a env, não sobe.
 *
 * NODE_ENV=test usa um valor só de teste para os testes rodarem sem .env.
 */
function resolveSecret(name, env = process.env) {
  const value = env[name];
  if (typeof value === 'string' && value.trim().length > 0) return value;
  if (env.NODE_ENV === 'test') return `test-only-${name}`;
  throw new Error(
    `${name} não está definido. Configure a variável de ambiente antes de iniciar a API legada.`,
  );
}

module.exports = { resolveSecret };
