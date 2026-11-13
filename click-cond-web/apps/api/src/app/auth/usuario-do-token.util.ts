import type { JwtPayload } from './jwt-payload.interface';
import type { AuditoriaAutorTipo } from '../auditoria/auditoria.service';

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

/**
 * Funcionarios_Portaria.id do porteiro logado no console (`tipo_sub`
 * carimbado no login). Qualquer outro token — inclusive o síndico ou o
 * funcionário por QR no console, que têm Users.id — devolve null.
 */
export function idFuncionarioPortariaDoToken(payload?: JwtPayload | null): number | null {
  if (!payload || (payload as any).role === 'crm_admin') return null;
  if (payload.tipo_sub !== 'funcionario_portaria') return null;
  const id = Number(payload.sub);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Autor para audit_logs (`autor_id` + `autor_tipo`): o id de quem está logado e em qual tabela ele vive.
 *
 *  - CRM (`role: 'crm_admin'`)                     → crm_admins.id
 *  - porteiro do console (`tipo_sub` carimbado)    → Funcionarios_Portaria.id
 *  - token de usuário (Sindico/Morador/Funcionario, inclusive síndico no console e sessão por QR) → Users.id
 *  - sem token                                     → 'sistema', sem id
 *
 * Forma não reconhecida devolve os dois null: a tabela do `sub` nunca é inferida pela forma do token
 * (um id gravado com o tipo errado aponta para outra pessoa).
 */
export function autorDoToken(
  payload?: JwtPayload | null,
): { autor_id: number | null; autor_tipo: AuditoriaAutorTipo | null } {
  if (!payload) return { autor_id: null, autor_tipo: 'sistema' };
  const sub = Number(payload.sub) || null;
  if ((payload as any).role === 'crm_admin') {
    return sub ? { autor_id: sub, autor_tipo: 'crm_admin' } : { autor_id: null, autor_tipo: null };
  }
  if (payload.tipo_sub === 'funcionario_portaria') {
    return sub ? { autor_id: sub, autor_tipo: 'funcionario_portaria' } : { autor_id: null, autor_tipo: null };
  }
  const idUser = idUsuarioDoToken(payload);
  if (idUser) return { autor_id: idUser, autor_tipo: 'user' };
  return { autor_id: null, autor_tipo: null };
}
