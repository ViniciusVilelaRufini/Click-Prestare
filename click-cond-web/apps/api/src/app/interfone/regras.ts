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
 * Posição (1, 2, 3…) de cada bloco distinto na ordem natural ("Bloco 2" antes
 * de "Bloco 10"), pela chave normalizada ("Bloco A" = "A").
 */
function posicaoDosBlocos(aptos: AptoParaRamal[]): Map<string, number> {
  const chaves = [...new Set(aptos.map((a) => normalizarBloco(a.bloco)).filter(Boolean))];
  chaves.sort((x, y) => x.localeCompare(y, 'pt-BR', { numeric: true, sensitivity: 'base' }));
  return new Map(chaves.map((c, i) => [c, i + 1]));
}

/**
 * Sugere o ramal de cada unidade: os dígitos do apto ("Apto 12-B" → "12").
 * Quando esse número já é ocupado por outra unidade (dois blocos com o
 * apto "106"), a sugestão ganha na frente a posição do bloco na ordem natural
 * dos blocos do condomínio: A·106 → "1106", B·106 → "2106". Unidade sem
 * bloco fica só com os dígitos.
 *
 * O número que cada unidade "ocupa" é o ramal gravado ou, sem ramal, a própria
 * sugestão. `conflito`: sem ramal gravado, nem a sugestão com prefixo ficou
 * livre (mesmo número no mesmo bloco, ou passou de 10 dígitos); com ramal
 * gravado, outro ramal gravado é igual. Nunca sugere um número em conflito:
 * a sugestão vira null e o síndico escolhe à mão.
 */
export function sugerirRamais(aptos: AptoParaRamal[]): Map<number, { sugestao: string | null; conflito: boolean }> {
  const contar = (lista: (string | null)[]) => {
    const m = new Map<string, number>();
    for (const n of lista) if (n) m.set(n, (m.get(n) ?? 0) + 1);
    return m;
  };
  const gravado = contar(aptos.map((a) => a.ramal || null));
  const posicao = posicaoDosBlocos(aptos);

  // O número que a unidade i ocupa e quantas OUTRAS unidades ocupam n.
  const digs = aptos.map((a) => digitos(a.apto));
  const outros = (ocupado: Map<string, number>, proprio: string | null, n: string) =>
    (ocupado.get(n) ?? 0) - (n === proprio ? 1 : 0);

  // 1ª passada: só os dígitos. Quem colide tenta o prefixo do bloco.
  const efetivo1 = aptos.map((a, i) => a.ramal || digs[i]);
  const ocupado1 = contar(efetivo1);
  const cands = aptos.map((a, i) => {
    const d = digs[i];
    if (!d || outros(ocupado1, efetivo1[i], d) === 0) return d;
    const pos = posicao.get(normalizarBloco(a.bloco));
    if (!pos) return d; // sem bloco: fica com os dígitos
    const p = `${pos}${d}`;
    return p.length <= 10 ? p : null;
  });

  // 2ª passada: o número sugerido tem de estar livre de todas as outras.
  const efetivo2 = aptos.map((a, i) => a.ramal || cands[i]);
  const ocupado2 = contar(efetivo2);
  const r = new Map<number, { sugestao: string | null; conflito: boolean }>();
  aptos.forEach((a, i) => {
    const c = cands[i];
    const sugestao = c && outros(ocupado2, efetivo2[i], c) === 0 ? c : null;
    // Ramal gravado só conflita com outro ramal gravado (é ele que o facial
    // usa); quem não tem ramal conflita quando ficou sem sugestão.
    const conflito = a.ramal ? (gravado.get(a.ramal) ?? 0) > 1 : !!digs[i] && !sugestao;
    r.set(a.id, { sugestao, conflito });
  });
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
