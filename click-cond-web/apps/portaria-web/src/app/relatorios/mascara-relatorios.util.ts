/**
 * Máscara da Central de Relatórios — o MESMO formato que a API grava e devolve
 * (apps/api/src/app/common/auditoria-redacao.util.ts): só os 4 últimos dígitos
 * ficam à vista. A tela não tem "revelar", então nada além disso aparece.
 *
 * Não é o MaskDocPipe global (shared/mask-doc.pipe.ts): aquele mostra o início
 * e o fim e serve às telas que têm "revelar". Aqui, misturar os dois formatos
 * revelaria 7 dos 11 dígitos do CPF (os 3 primeiros de um, os 4 últimos do outro).
 *
 * Valor que já chega mascarado (contém `*`) fica como está; valor sem dígito
 * (ex.: "Não informado") também.
 */

/** CPF "45346648852" → "***.***.*88-52"; outro documento → "***" + 4 últimos dígitos (2 se for curto). */
export function mascararDocumentoRelatorio(valor: unknown): string {
  if (valor === null || valor === undefined || valor === '') return '';
  const s = String(valor);
  if (s.includes('*') || !/\d/.test(s)) return s;
  const d = s.replace(/\D/g, '');
  if (d.length === 11) return `***.***.*${d.slice(7, 9)}-${d.slice(9)}`;
  if (d.length >= 8) return `***${d.slice(-4)}`;
  if (d.length >= 4) return `***${d.slice(-2)}`;
  return '***';
}

/** Telefone com DDD → "(**) *****-0000"; sem DDD → "***0000"; curto → "***". */
export function mascararTelefoneRelatorio(valor: unknown): string {
  if (valor === null || valor === undefined || valor === '') return '';
  const s = String(valor);
  if (s.includes('*') || !/\d/.test(s)) return s;
  const d = s.replace(/\D/g, '');
  if (d.length >= 10) return `(**) *****-${d.slice(-4)}`;
  if (d.length >= 6) return `***${d.slice(-4)}`;
  return '***';
}
