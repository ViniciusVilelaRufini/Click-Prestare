/**
 * Decide se um pedido ao servidor de arquivos estáticos (dist/assets servido na
 * raiz por main.ts) deve ser recusado. A comparação é feita no caminho
 * DECODIFICADO: o serve-static/send decodifica antes de abrir o arquivo, então
 * '/firebase-service%2Daccount.jso%6E' chega no disco como
 * '/firebase-service-account.json'. Codificação inválida também é recusada.
 */
export function caminhoEstaticoBloqueado(caminho: string | undefined): boolean {
  let decodificado: string;
  try {
    decodificado = decodeURIComponent(caminho ?? '');
  } catch {
    return true;
  }
  return /^\/[^/]+\.json$/i.test(decodificado) || /service-account/i.test(decodificado);
}
