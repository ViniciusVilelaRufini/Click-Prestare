/**
 * Regra única de "quem é porteiro" no console: tem turno e o turno não é
 * 'Síndico'. Sidebar e guard usam a mesma função para o menu e a rota nunca
 * discordarem. Quem trava de verdade é a API (assertSindicoEstrito no facial);
 * isto só evita levar o porteiro a uma tela que vai devolver 403.
 */
export function ehPorteiro(info: { turno?: string | null } | null | undefined): boolean {
  return !!info?.turno && info.turno !== 'Síndico';
}

/** Telas que o porteiro não vê no menu e não pode abrir pela URL. */
export const ROTAS_SO_SINDICO = ['financeiro', 'relatorios', 'configuracoes', 'terminais-faciais'];
