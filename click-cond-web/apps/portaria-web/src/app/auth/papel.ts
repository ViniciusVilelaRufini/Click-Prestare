/**
 * Regra única de "quem é porteiro" no console: tem turno e o turno não é
 * 'Síndico'. Sidebar e guard usam a mesma função para o menu e a rota nunca
 * discordarem. Quem trava de verdade é a API (assertSindicoEstrito no facial);
 * isto só evita levar o porteiro a uma tela que vai devolver 403.
 */
export function ehPorteiro(info: { turno?: string | null } | null | undefined): boolean {
  return !!info?.turno && info.turno !== 'Síndico';
}

/**
 * Telas que o porteiro não vê no menu e não pode abrir pela URL. Configurações fica de fora: o porteiro abre a
 * tela para trocar a própria senha, e ela só mostra a ele a aba "Segurança e Perfil".
 */
export const ROTAS_SO_SINDICO = ['financeiro', 'relatorios', 'terminais-faciais'];

/**
 * `typeAccess` do token da sessão ('Sindico', 'Funcionario'…), em minúsculas.
 * É carimbado pela API no login a partir do banco — o porteiro de
 * login/senha não tem. Só decide o que a tela mostra: a API confere a
 * assinatura e decide de verdade. Token ausente ou ilegível → null.
 */
export function papelDoToken(token: string | null | undefined): string | null {
  const parte = token?.split('.')[1];
  if (!parte) return null;
  try {
    const b64 = parte.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    const tipo = payload?.typeAccess ?? payload?.user?.typeAccess;
    return typeof tipo === 'string' && tipo ? tipo.toLowerCase() : null;
  } catch {
    return null;
  }
}
