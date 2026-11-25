/**
 * Login para log (CloudWatch e audit_logs de tentativa falha): 2 primeiras letras + domínio.
 * "joaquim@demo.com" → "jo***@demo.com". Quem digita a senha no campo de login não a deixa no log.
 */
export function mascararLogin(login: unknown): string {
  const s = typeof login === 'string' ? login.trim() : '';
  const arroba = s.indexOf('@');
  return arroba > 0 ? `${s.slice(0, 2)}***${s.slice(arroba)}` : `${s.slice(0, 2)}***`;
}
