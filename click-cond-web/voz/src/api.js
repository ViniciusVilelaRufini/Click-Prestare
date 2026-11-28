// Cliente das rotas internas da API (/api/interno/interfone/*), autenticado pelo
// cabeçalho x-voz-token. Toda chamada tem prazo; erro HTTP vira exceção.

export function criarApi({ apiBase, vozToken, fetch = globalThis.fetch, timeoutMs = 5000 }) {
  const base = String(apiBase).replace(/\/+$/, '');

  async function pedir(metodo, caminho, corpo) {
    const op = {
      method: metodo,
      headers: { 'x-voz-token': vozToken, accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    };
    if (corpo !== undefined) {
      op.headers['content-type'] = 'application/json';
      op.body = JSON.stringify(corpo);
    }
    const r = await fetch(`${base}${caminho}`, op);
    if (!r.ok) throw new Error(`API ${metodo} ${caminho} respondeu ${r.status}`);
    return r.json();
  }

  return {
    contas: () => pedir('GET', '/interno/interfone/contas'),
    novaChamada: (conta, numero) => pedir('POST', '/interno/interfone/chamadas', { conta, numero }),
    chamada: (id) => pedir('GET', `/interno/interfone/chamadas/${Number(id)}`),
    evento: (id, ev) => pedir('POST', `/interno/interfone/chamadas/${Number(id)}/evento`, ev),
    registros: (contas) => pedir('POST', '/interno/interfone/registros', { contas }),
  };
}
