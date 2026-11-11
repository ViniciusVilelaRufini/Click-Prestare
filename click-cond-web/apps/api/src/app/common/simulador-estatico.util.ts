/**
 * Páginas HTML de simulador (src/assets/*.html, servidas na raiz por main.ts).
 *
 * São andaimes de teste: os controllers que elas chamam só são montados com
 * `FACIAL_SIMULATOR_ENABLED=true` (ver facial.module.ts). O HTML obedece à
 * mesma variável — sem ela, responde 404 como se não existisse.
 */

/** Mesma leitura da env feita em facial.module.ts. */
export function simuladorHabilitado(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return String(env['FACIAL_SIMULATOR_ENABLED'] ?? '').toLowerCase() === 'true';
}

/**
 * Decide se um pedido ao servidor de arquivos estáticos deve ser recusado por
 * ser página de simulador com o simulador desligado. Todo `.html` de assets é
 * simulador, então a regra é pela extensão: página nova já nasce bloqueada.
 *
 * Como em `caminhoEstaticoBloqueado`, compara o caminho DECODIFICADO (o
 * serve-static decodifica antes de abrir o arquivo) e recusa codificação
 * inválida.
 */
export function paginaSimuladorBloqueada(
  caminho: string | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (simuladorHabilitado(env)) return false;
  let decodificado: string;
  try {
    decodificado = decodeURIComponent(caminho ?? '');
  } catch {
    return true;
  }
  return /\.html?$/i.test(decodificado);
}
