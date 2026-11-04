import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Pentest I-01: o Nest roda os APP_GUARD na ordem em que são registrados. Com o
 * ThrottlerGuard depois do JwtAuthGuard/TenantGuard, requisição recusada com
 * 401/403 não consumia o limite: dava para martelar token inválido ou trocar
 * de condomínio na URL sem freio.
 */
describe('APP_GUARD — ThrottlerGuard roda primeiro (I-01)', () => {
  it('ThrottlerGuard é registrado antes do JwtAuthGuard e do TenantGuard', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'app.module.ts'), 'utf8');
    const guards = [...src.matchAll(/provide:\s*APP_GUARD,\s*useClass:\s*(\w+)/g)].map((m) => m[1]);
    expect(guards[0]).toBe('ThrottlerGuard');
    expect(guards).toEqual(expect.arrayContaining(['JwtAuthGuard', 'TenantGuard']));
  });
});
