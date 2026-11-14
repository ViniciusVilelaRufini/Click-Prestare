import qrcode from 'qrcode-generator';

/**
 * Folha do QR de entregas, para imprimir e colar no portão.
 *
 * O QR é desenhado aqui mesmo (qrcode-generator → SVG): o link do portão não
 * vai para serviço de terceiro nenhum. A folha é A5, fundo branco e texto
 * preto — é papel colado na rua, não tela do console —, com o QR de 80 mm
 * (acima dos 60 mm que um celular lê de um passo de distância).
 */

/** Margem branca obrigatória do QR, em módulos. */
const MARGEM_MODULOS = 4;

/** Lado do QR impresso. */
const LADO_QR_MM = 80;

/** SVG do QR do texto (nível M, margem de 4 módulos, fundo branco). */
export function svgDoQr(texto: string, ladoMm = LADO_QR_MM): string {
  const qr = qrcode(0, 'M');
  qr.addData(texto, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) d += `M${c + MARGEM_MODULOS},${r + MARGEM_MODULOS}h1v1h-1z`;
    }
  }
  const lado = n + MARGEM_MODULOS * 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}" ` +
    `width="${ladoMm}mm" height="${ladoMm}mm" shape-rendering="crispEdges" role="img" aria-label="QR de entregas">` +
    `<rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`
  );
}

/** Os nomes vêm do cadastro: viram texto, nunca HTML, na janela nova (mesma origem do console). */
function escapar(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

/** Documento HTML completo da folha. `svgQr` é o SVG já desenhado (svgDoQr). */
export function htmlDaFolha(d: { condominio: string; portao: string; svgQr: string }): string {
  const condominio = escapar(d.condominio);
  const portao = escapar(d.portao);
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>QR de entregas · ${portao}</title>
<style>
  @page { size: A5 portrait; margin: 12mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #fff; color: #000; }
  body {
    font-family: Poppins, "Segoe UI", Arial, sans-serif;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .folha {
    min-height: calc(210mm - 24mm);
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 6mm; text-align: center;
  }
  h1 { margin: 0; font-size: 30pt; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
  .chamada { margin: 0; font-size: 16pt; font-weight: 600; }
  .qr { width: ${LADO_QR_MM}mm; height: ${LADO_QR_MM}mm; }
  .qr svg { display: block; width: 100%; height: 100%; }
  .condominio { margin: 0; font-size: 14pt; font-weight: 600; }
  .portao { margin: 0; font-size: 12pt; }
  .rodape { margin: 0; font-size: 9pt; }
</style>
</head>
<body>
<main class="folha">
  <h1>Entregas</h1>
  <p class="chamada">Aponte a câmera aqui</p>
  <div class="qr">${d.svgQr}</div>
  <p class="condominio">${condominio}</p>
  <p class="portao">${portao}</p>
  <p class="rodape">Informe a unidade e tire uma foto. O morador libera a entrada.</p>
</main>
</body>
</html>`;
}
