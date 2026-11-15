/**
 * As 8 permissões do vínculo de equipe (Funcionarios) que o síndico liga e desliga no app. Ao tirar o acesso à
 * portaria de um prestador o vínculo é apagado (muitos pontos conferem a existência da linha, então não há "ativo"
 * nela); as flags ficam guardadas em Prestadores_servico.permissoes_app_salvas e voltam quando o acesso volta.
 */
export const FLAGS_PERMISSAO_APP = [
  'areas_sociais',
  'comunicados',
  'ocorrencias',
  'manutencoes_programadas',
  'prestadores_servico',
  'agendar_mudanca',
  'cadastrar_visitante',
  'apartamentos',
] as const;

export type PermissoesApp = Record<(typeof FLAGS_PERMISSAO_APP)[number], 0 | 1>;

/** JSON das flags do vínculo; null se não há vínculo. Valor ausente/nulo conta como ligado (o default do banco é 0, mas a concessão grava 1). */
export function serializarPermissoesApp(vinculo: Record<string, any> | null | undefined): string | null {
  if (!vinculo) return null;
  const out: Record<string, number> = {};
  for (const k of FLAGS_PERMISSAO_APP) out[k] = vinculo[k] == null ? 1 : Number(vinculo[k]) ? 1 : 0;
  return JSON.stringify(out);
}

/**
 * Lê o JSON guardado. Qualquer coisa fora do formato (nulo, texto quebrado, chave faltando, valor que não é 0/1)
 * devolve null — quem chama cai no padrão. Nunca lança: o login do app usa isto.
 */
export function lerPermissoesSalvas(json: unknown): PermissoesApp | null {
  if (typeof json !== 'string' || !json.trim()) return null;
  let obj: any;
  try {
    obj = JSON.parse(json);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const out: Partial<PermissoesApp> = {};
  for (const k of FLAGS_PERMISSAO_APP) {
    const v = obj[k];
    if (v !== 0 && v !== 1) return null;
    out[k] = v;
  }
  return out as PermissoesApp;
}
