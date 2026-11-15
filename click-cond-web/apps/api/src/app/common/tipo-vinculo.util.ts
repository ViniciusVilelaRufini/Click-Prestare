/** Vínculo de uma conta com a unidade, no vocabulário canônico. */
export type TipoVinculo = 'proprietario' | 'inquilino' | 'membro';

/**
 * Normaliza `Apartamentos_Users.tipo` / `Moradores.tipo` para o vocabulário
 * canônico. Trata dados legados/sujos: 'Proprietário'/'morador'/null/'' →
 * 'proprietario'; 'dependente' → 'membro'. Robusto a acento e caixa.
 * (Extraído do MobileAuthService.normalizeTipo, sem mudar o comportamento.)
 */
export function normalizarTipoVinculo(raw: string | null | undefined): TipoVinculo {
  const t = (raw ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
  if (t === 'inquilino') return 'inquilino';
  if (t === 'membro' || t === 'dependente') return 'membro';
  // 'proprietario', 'morador', '', null e variantes corrompidas → proprietario
  return 'proprietario';
}

const NIVEL: Record<TipoVinculo, number> = { membro: 1, inquilino: 2, proprietario: 3 };

/** Nível na hierarquia da unidade: proprietario (3) > inquilino (2) > membro (1). */
export function nivelVinculo(tipo: TipoVinculo): number {
  return NIVEL[tipo];
}

/** O vínculo mais alto entre vários (crus ou normalizados) da mesma conta na unidade; nenhum: null. */
export function maiorVinculo(tipos: Array<string | null | undefined>): TipoVinculo | null {
  let melhor: TipoVinculo | null = null;
  for (const raw of tipos) {
    const t = normalizarTipoVinculo(raw);
    if (!melhor || NIVEL[t] > NIVEL[melhor]) melhor = t;
  }
  return melhor;
}
