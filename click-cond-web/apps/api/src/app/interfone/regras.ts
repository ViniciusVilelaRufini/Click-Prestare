import { normalizarBloco } from '../common/rotulo-bloco.util';

/**
 * Regras puras do interfone (sem banco): ramais das unidades e blocos que um
 * facial chama.
 */

export interface AptoParaRamal {
  id: number;
  apto: string | null;
  bloco: string | null;
  /** Ramal já gravado (Apartamentos.interfone_ramal). */
  ramal: string | null;
}

/** Ramal: só dígitos, de 1 a 10. */
export function ramalValido(r: string): boolean {
  return typeof r === 'string' && /^\d{1,10}$/.test(r);
}

function digitos(apto: string | null): string | null {
  const d = (apto ?? '').replace(/\D/g, '').slice(0, 10);
  return d ? d : null;
}

/**
 * Sugere o ramal de cada unidade: só os dígitos do apto ("Apto 12-B" → "12").
 *
 * O número que cada unidade "ocupa" é o ramal gravado ou, sem ramal, a própria
 * sugestão. `conflito`: sem ramal gravado, a sugestão é ocupada por outra
 * unidade (dois aptos "106" em blocos diferentes); com ramal gravado, outro
 * ramal gravado é igual. Nunca sugere um número em conflito: a sugestão vira
 * null e o síndico escolhe à mão.
 */
export function sugerirRamais(aptos: AptoParaRamal[]): Map<number, { sugestao: string | null; conflito: boolean }> {
  const contar = (m: Map<string, number>, n: string | null) => {
    if (n) m.set(n, (m.get(n) ?? 0) + 1);
  };
  const ocupado = new Map<string, number>();
  const gravado = new Map<string, number>();
  const itens = aptos.map((a) => ({ a, cand: digitos(a.apto), efetivo: a.ramal || digitos(a.apto) }));
  for (const i of itens) {
    contar(ocupado, i.efetivo);
    contar(gravado, i.a.ramal || null);
  }

  const r = new Map<number, { sugestao: string | null; conflito: boolean }>();
  for (const { a, cand, efetivo } of itens) {
    // Quantas OUTRAS unidades ocupam o número n.
    const outros = (n: string) => (ocupado.get(n) ?? 0) - (n === efetivo ? 1 : 0);
    // Ramal gravado só conflita com outro ramal gravado (é ele que o facial
    // usa); a sugestão de quem ainda não tem ramal conflita com tudo.
    const conflito = a.ramal ? (gravado.get(a.ramal) ?? 0) > 1 : !!cand && outros(cand) > 0;
    const sugestao = cand && outros(cand) === 0 ? cand : null;
    r.set(a.id, { sugestao, conflito });
  }
  return r;
}

/**
 * O facial chama esta unidade? `blocosJson` é o JSON array gravado em
 * Facial_Devices.interfone_blocos; null, vazio ou lista vazia = todos os
 * blocos. Compara por normalizarBloco ("Bloco A" = "A"). JSON inválido falha
 * fechado (não chama ninguém) — melhor "apartamento não encontrado" do que
 * tocar no bloco errado.
 */
export function facialAtendeBloco(blocosJson: string | null, bloco: string | null): boolean {
  if (blocosJson == null || blocosJson.trim() === '') return true;
  let lista: unknown;
  try {
    lista = JSON.parse(blocosJson);
  } catch {
    return false;
  }
  if (!Array.isArray(lista)) return false;
  if (lista.length === 0) return true;
  const alvo = normalizarBloco(bloco);
  if (!alvo) return false;
  return lista.some((b) => typeof b === 'string' && normalizarBloco(b) === alvo);
}
