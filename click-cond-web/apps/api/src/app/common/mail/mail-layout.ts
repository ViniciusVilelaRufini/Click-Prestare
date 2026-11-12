/**
 * Layout dos e-mails transacionais no tema Prestare Dark (mesmos tokens da
 * portaria-web, apps/portaria-web/src/styles.css). Tudo inline e em tabelas,
 * porque Gmail e Outlook descartam <style> e ignoram flex/grid. A fonte
 * Barlow só carrega em clientes que aceitam <link> (Apple Mail, iOS); nos
 * demais cai para Arial Narrow/Arial, que mantém o desenho condensado.
 */

const SITE = 'https://www.prestarecondominios.com.br';
const MARCA_URL = `${SITE}/email/prestare-marca-branca.png`;

/** Tokens do tema escuro. */
const C = {
  bg000: '#000000',
  bg100: '#0b0b0b',
  bg200: '#141414',
  line100: '#242424',
  line200: '#666666',
  ink: '#ffffff',
  inkMuted: '#a3a3a3',
  inkSubtle: '#8a8a8a',
  brand: '#ffc83d',
  onBrand: '#000000',
  warn: '#e3b04b',
  danger: '#ff6b6b',
};

const FONTE_DISPLAY = "'Barlow Condensed','Arial Narrow',Arial,Helvetica,sans-serif";
const FONTE_TEXTO = "Barlow,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const FONTE_MONO = "'SFMono-Regular',Menlo,Consolas,'Courier New',monospace";

export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Parágrafo de corpo. Recebe HTML já escapado. */
export function paragrafo(html: string): string {
  return `<p style="margin:0 0 16px 0;font-family:${FONTE_TEXTO};font-size:15px;line-height:24px;color:${C.inkMuted};">${html}</p>`;
}

/** Destaque dentro do parágrafo. Recebe HTML já escapado. */
export function forte(html: string): string {
  return `<strong style="color:${C.ink};font-weight:600;">${html}</strong>`;
}

function rotulo(texto: string, cor = C.inkSubtle): string {
  return `<div style="font-family:${FONTE_DISPLAY};font-weight:600;font-size:11px;line-height:14px;letter-spacing:2.2px;text-transform:uppercase;color:${cor};">${esc(texto)}</div>`;
}

/** Código ou senha em destaque (amarelo da marca sobre preto). */
export function caixaCodigo(label: string, valor: string): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px 0;">
      <tr>
        <td align="center" bgcolor="${C.bg000}" style="background-color:${C.bg000};border:1px solid ${C.line100};border-top:2px solid ${C.brand};padding:20px 16px 22px 16px;">
          ${rotulo(label)}
          <div style="margin-top:10px;font-family:${FONTE_DISPLAY};font-weight:600;font-size:42px;line-height:48px;letter-spacing:10px;color:${C.brand};font-variant-numeric:tabular-nums;word-break:break-all;">${esc(valor)}</div>
        </td>
      </tr>
    </table>`;
}

/** Botão primário (amarelo da marca, texto preto, caixa alta). */
export function botao(href: string, texto: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px 0;">
      <tr>
        <td bgcolor="${C.brand}" style="background-color:${C.brand};">
          <a href="${esc(href)}" target="_blank" style="display:inline-block;padding:15px 26px;font-family:${FONTE_DISPLAY};font-weight:600;font-size:14px;line-height:18px;letter-spacing:2.5px;text-transform:uppercase;color:${C.onBrand};text-decoration:none;">${esc(texto)}</a>
        </td>
      </tr>
    </table>`;
}

/** Painel de dados: pares rótulo/valor. Valores recebem HTML já escapado. */
export function painelDados(
  linhas: Array<{ label: string; valor: string; cor?: string; grande?: boolean; mono?: boolean }>,
): string {
  const cel = linhas
    .map((l, i) => {
      const borda = i > 0 ? `border-top:1px solid ${C.line100};` : '';
      const fonte = l.mono ? FONTE_MONO : l.grande ? FONTE_DISPLAY : FONTE_TEXTO;
      const tamanho = l.mono ? 'font-size:12px;line-height:18px;' : l.grande ? 'font-size:28px;line-height:32px;' : 'font-size:15px;line-height:22px;';
      return `
      <tr>
        <td style="${borda}padding:14px 18px;">
          ${rotulo(l.label)}
          <div style="margin-top:6px;font-family:${fonte};${tamanho}font-weight:600;color:${l.cor ?? C.ink};word-break:break-all;">${l.valor}</div>
        </td>
      </tr>`;
    })
    .join('');
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.bg100}" style="margin:8px 0 24px 0;background-color:${C.bg100};border:1px solid ${C.line100};">
      ${cel}
    </table>`;
}

/** Caixa de dica/aviso com filete lateral. Recebe HTML já escapado. */
export function nota(html: string, tom: 'info' | 'alerta' = 'info'): string {
  const filete = tom === 'alerta' ? C.warn : C.line200;
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px 0;">
      <tr>
        <td bgcolor="${C.bg100}" style="background-color:${C.bg100};border-left:2px solid ${filete};padding:12px 16px;font-family:${FONTE_TEXTO};font-size:13px;line-height:20px;color:${C.inkMuted};">${html}</td>
      </tr>
    </table>`;
}

/** Link secundário, discreto. */
export function linkSecundario(href: string, texto: string): string {
  return `<p style="margin:0 0 16px 0;font-family:${FONTE_TEXTO};font-size:13px;line-height:20px;"><a href="${esc(href)}" style="color:${C.ink};text-decoration:underline;">${esc(texto)}</a></p>`;
}

/** URL longa para copiar e colar. */
export function urlCopiavel(intro: string, href: string): string {
  return `
    <p style="margin:0 0 6px 0;font-family:${FONTE_TEXTO};font-size:12px;line-height:18px;color:${C.inkSubtle};">${esc(intro)}</p>
    <p style="margin:0 0 20px 0;font-family:${FONTE_MONO};font-size:12px;line-height:18px;word-break:break-all;"><a href="${esc(href)}" style="color:${C.brand};text-decoration:none;">${esc(href)}</a></p>`;
}

/**
 * Documento completo. `corpo` é HTML já montado com os helpers acima;
 * `titulo`, `eyebrow` e `preheader` são texto puro (escapados aqui).
 */
export function layoutEmail(opts: {
  assunto: string;
  preheader: string;
  eyebrow: string;
  titulo: string;
  corpo: string;
}): string {
  const ano = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>${esc(opts.assunto)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@300;600&family=Barlow:wght@400;600&display=swap" rel="stylesheet">
  <style>
    :root { color-scheme: dark; supported-color-schemes: dark; }
    body { margin:0 !important; padding:0 !important; background-color:${C.bg000}; }
    a { color:${C.brand}; }
    @media (max-width: 560px) {
      .ps-card { padding:28px 20px !important; }
      .ps-titulo { font-size:24px !important; line-height:28px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:${C.bg000};" bgcolor="${C.bg000}">
  <div style="display:none;font-size:1px;color:${C.bg000};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${esc(opts.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.bg000}" style="background-color:${C.bg000};">
    <tr>
      <td align="center" style="padding:32px 12px 40px 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">

          <!-- Marca -->
          <tr>
            <td style="padding:0 0 20px 0;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="vertical-align:middle;padding-right:12px;">
                    <img src="${MARCA_URL}" alt="" width="23" height="32" style="display:block;border:0;outline:none;">
                  </td>
                  <td style="vertical-align:middle;font-family:${FONTE_DISPLAY};font-weight:600;font-size:17px;line-height:18px;letter-spacing:1.7px;text-transform:uppercase;color:${C.ink};">
                    Prestare<span style="font-weight:300;color:${C.inkMuted};"> Condomínios</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Cartão -->
          <tr>
            <td class="ps-card" bgcolor="${C.bg200}" style="background-color:${C.bg200};border:1px solid ${C.line100};border-top:2px solid ${C.brand};padding:36px 32px 28px 32px;">
              ${rotulo(opts.eyebrow)}
              <h1 class="ps-titulo" style="margin:10px 0 24px 0;font-family:${FONTE_DISPLAY};font-weight:600;font-size:28px;line-height:32px;letter-spacing:2px;text-transform:uppercase;color:${C.ink};">${esc(opts.titulo)}</h1>
              ${opts.corpo}
            </td>
          </tr>

          <!-- Rodapé -->
          <tr>
            <td style="padding:24px 4px 0 4px;font-family:${FONTE_TEXTO};font-size:12px;line-height:18px;color:${C.inkSubtle};">
              Equipe Prestare Condomínios ·
              <a href="${SITE}" target="_blank" style="color:${C.ink};text-decoration:none;">prestarecondominios.com.br</a><br>
              <span style="color:${C.line200};">Mensagem automática · © ${ano} Prestare</span>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
