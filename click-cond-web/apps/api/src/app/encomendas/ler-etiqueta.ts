export interface LeituraEtiqueta {
  nome: string | null;
  apto: string | null;
  bloco: string | null;
  transportadora: string | null;
  codigo_rastreio: string | null;
  descricao: string | null;
}

export interface MoradorBasico {
  nome: string;
  apartamento: string | null;
  bloco: string | null;
}

export interface DestinatarioCasado {
  apto: string;
  bloco: string | null;
  nome: string;
}

const CHAVES: (keyof LeituraEtiqueta)[] = [
  'nome', 'apto', 'bloco', 'transportadora', 'codigo_rastreio', 'descricao',
];

export function leituraVazia(): LeituraEtiqueta {
  return { nome: null, apto: null, bloco: null, transportadora: null, codigo_rastreio: null, descricao: null };
}

/** Aceita JSON puro ou dentro de cerca ```; qualquer outra coisa vira tudo null. */
export function extrairLeitura(texto: string): LeituraEtiqueta {
  const out = leituraVazia();
  if (!texto) return out;
  let corpo = texto.trim();
  const cerca = corpo.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (cerca) corpo = cerca[1].trim();
  let obj: unknown;
  try {
    obj = JSON.parse(corpo);
  } catch {
    const ini = corpo.indexOf('{');
    const fim = corpo.lastIndexOf('}');
    if (ini < 0 || fim <= ini) return out;
    try {
      obj = JSON.parse(corpo.slice(ini, fim + 1));
    } catch {
      return out;
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  for (const k of CHAVES) {
    const v = (obj as Record<string, unknown>)[k];
    if (typeof v === 'string' || typeof v === 'number') {
      const s = String(v).trim();
      out[k] = s ? s : null;
    }
  }
  return out;
}

function norm(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nomeCasa(lido: string, cadastrado: string): boolean {
  if (!lido || !cadastrado) return false;
  const a = lido.split(' ').filter((p) => p.length > 1);
  const b = new Set(cadastrado.split(' ').filter((p) => p.length > 1));
  const comuns = a.filter((p) => b.has(p)).length;
  if (comuns >= 2) return true;
  return (
    (lido.split(' ').length >= 2 && ` ${cadastrado} `.includes(` ${lido} `)) ||
    (cadastrado.split(' ').length >= 2 && ` ${lido} `.includes(` ${cadastrado} `))
  );
}

function aptoIgual(a: string | null, b: string | null): boolean {
  return norm(a) !== '' && norm(a) === norm(b);
}

function resultado(m: MoradorBasico): DestinatarioCasado {
  return { apto: m.apartamento as string, bloco: m.bloco, nome: m.nome };
}

export function casarMorador(
  leitura: LeituraEtiqueta,
  moradores: MoradorBasico[],
): DestinatarioCasado | null {
  const comApto = moradores.filter((m) => m.apartamento);
  const nomeLido = norm(leitura.nome);
  let candidatos = comApto.filter((m) => nomeCasa(nomeLido, norm(m.nome)));

  if (candidatos.length > 1 && leitura.apto) {
    const f = candidatos.filter((m) => aptoIgual(m.apartamento, leitura.apto));
    if (f.length) candidatos = f;
    if (candidatos.length > 1 && leitura.bloco) {
      const fb = candidatos.filter((m) => norm(m.bloco) === norm(leitura.bloco));
      if (fb.length) candidatos = fb;
    }
  }
  if (candidatos.length > 0) {
    // Mesmo nome em mais de uma unidade e a etiqueta não desempata.
    const unidades = new Set(candidatos.map((m) => `${norm(m.apartamento)}|${norm(m.bloco)}`));
    if (unidades.size > 1) return null;
    const c = candidatos[0];
    // Apto/bloco lidos que contradizem o morador achado pelo nome: não adivinha.
    if (leitura.apto && !aptoIgual(c.apartamento, leitura.apto)) return null;
    if (leitura.bloco && c.bloco && norm(c.bloco) !== norm(leitura.bloco)) return null;
    return resultado(c);
  }

  // Nome sem correspondência: aceita só se o apto (e bloco, se lido) existir.
  if (leitura.apto) {
    let doApto = comApto.filter((m) => aptoIgual(m.apartamento, leitura.apto));
    if (leitura.bloco) {
      const fb = doApto.filter((m) => norm(m.bloco) === norm(leitura.bloco));
      if (fb.length) doApto = fb;
      else return null;
    }
    const unidades = new Set(doApto.map((m) => `${norm(m.apartamento)}|${norm(m.bloco)}`));
    if (unidades.size === 1) return resultado(doApto[0]);
  }
  return null;
}
