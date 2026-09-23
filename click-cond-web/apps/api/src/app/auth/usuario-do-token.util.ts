import type { JwtPayload } from './jwt-payload.interface';

/**
 * Users.id de quem está logado. Só existe em token de USUÁRIO (typeAccess
 * Sindico/Morador/Funcionario). O porteiro da portaria-web tem
 * `sub = Funcionarios_Portaria.id` — outra tabela, outra numeração: usá-lo
 * como Users.id atribui registros a outra pessoa, lê dados dela ou estoura a
 * FK. Token de CRM também não tem Users.id.
 */
export function idUsuarioDoToken(payload?: JwtPayload | null): number | null {
  if (!payload || (payload as any).role === 'crm_admin') return null;
  const tipo = (payload.typeAccess ?? payload.user?.typeAccess ?? '').toString().toLowerCase();
  if (!['sindico', 'morador', 'funcionario'].includes(tipo)) return null;
  const id = Number(payload.user?.id ?? payload.sub);
  return id || null;
}
