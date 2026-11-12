import * as fs from 'fs';
import { isAbsolute, join, relative, resolve } from 'path';

/**
 * Tema Prestare Dark para PDFs impressos: usa a variante clara dos tokens da
 * portaria-web (papel branco, tinta preta, amarelo #f2b10f como acento) com
 * Barlow / Barlow Condensed embutidas. As fontes e a marca ficam em
 * src/assets (copiadas para dist/assets no build). Se não forem encontradas,
 * o PDF sai em Helvetica e sem a marca, em vez de falhar.
 */

export const PDF_COR = {
  papel: '#ffffff',
  painel: '#f4f4f4',
  zebra: '#fafafa',
  linha: '#e2e2e2',
  tinta: '#000000',
  texto: '#262626',
  muted: '#555555',
  subtle: '#6b6b6b',
  marca: '#f2b10f',
};

function acharAssets(): string | null {
  const candidatos = [
    join(__dirname, 'assets'), // dist/main.js
    join(__dirname, '..', '..', 'assets'), // src/app/relatorios (ts-jest / ts-node)
    join(process.cwd(), 'apps', 'api', 'src', 'assets'),
    join(process.cwd(), 'src', 'assets'),
  ];
  return candidatos.find((dir) => fs.existsSync(join(dir, 'fonts', 'Barlow-Regular.ttf'))) ?? null;
}

let cache: {
  fontes: Record<string, any>;
  texto: string;
  display: string;
  displayLeve: string;
  marcaSvg: string | null;
  /** Pasta de fontes que o pdfmake pode ler; null quando caiu para Helvetica. */
  pastaFontes: string | null;
} | null = null;

const FONTES_PADRAO = new Set(['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique']);

/**
 * Trava o pdfmake: nenhuma URL externa e, no disco, só a pasta das fontes.
 * Os relatórios não usam imagem remota; um texto de usuário nunca vira leitura
 * de arquivo ou requisição.
 */
export function travarAcessosPdf(pdfmake: any): void {
  const pasta = temaPdf().pastaFontes;
  pdfmake.setUrlAccessPolicy?.(() => false);
  pdfmake.setLocalAccessPolicy?.((caminho: string) => {
    // Fontes padrão do PDF (reserva quando a Barlow não é achada) passam pelo
    // mesmo filtro, só pelo nome.
    if (FONTES_PADRAO.has(caminho)) return true;
    if (!pasta) return false;
    const rel = relative(pasta, resolve(caminho));
    return !!rel && !rel.startsWith('..') && !isAbsolute(rel);
  });
}

export function temaPdf() {
  if (cache) return cache;
  const dir = acharAssets();
  if (!dir) {
    cache = {
      fontes: {
        Helvetica: { normal: 'Helvetica', bold: 'Helvetica-Bold', italics: 'Helvetica-Oblique', bolditalics: 'Helvetica-BoldOblique' },
      },
      texto: 'Helvetica',
      display: 'Helvetica',
      displayLeve: 'Helvetica',
      marcaSvg: null,
      pastaFontes: null,
    };
    return cache;
  }
  const f = (nome: string) => join(dir, 'fonts', nome);
  let marcaSvg: string | null = null;
  try {
    marcaSvg = fs.readFileSync(join(dir, 'marca', 'prestare-marca-preta.svg'), 'utf8');
  } catch {
    marcaSvg = null;
  }
  cache = {
    fontes: {
      Barlow: {
        normal: f('Barlow-Regular.ttf'),
        bold: f('Barlow-SemiBold.ttf'),
        italics: f('Barlow-Regular.ttf'),
        bolditalics: f('Barlow-SemiBold.ttf'),
      },
      BarlowCondensed: {
        normal: f('BarlowCondensed-SemiBold.ttf'),
        bold: f('BarlowCondensed-SemiBold.ttf'),
        italics: f('BarlowCondensed-SemiBold.ttf'),
        bolditalics: f('BarlowCondensed-SemiBold.ttf'),
      },
      BarlowCondensedLight: {
        normal: f('BarlowCondensed-Light.ttf'),
        bold: f('BarlowCondensed-Light.ttf'),
        italics: f('BarlowCondensed-Light.ttf'),
        bolditalics: f('BarlowCondensed-Light.ttf'),
      },
    },
    texto: 'Barlow',
    display: 'BarlowCondensed',
    displayLeve: 'BarlowCondensedLight',
    marcaSvg,
    pastaFontes: join(dir, 'fonts'),
  };
  return cache;
}

/** Cabeçalho com a marca: ícone + "PRESTARE CONDOMÍNIOS" e um rótulo à direita. */
export function cabecalhoMarca(rotuloDireita: string): any {
  const t = temaPdf();
  const marca = t.marcaSvg ? [{ width: 26, stack: [{ svg: t.marcaSvg, width: 16 }] }] : [];
  return {
    columns: [
      {
        width: '*',
        columns: [
          ...marca,
          {
            width: 'auto',
            margin: [0, t.marcaSvg ? 6 : 0, 0, 0],
            text: [
              { text: 'PRESTARE', font: t.display, fontSize: 13, color: PDF_COR.tinta, characterSpacing: 1.3 },
              { text: ' CONDOMÍNIOS', font: t.displayLeve, fontSize: 13, color: PDF_COR.muted, characterSpacing: 1.3 },
            ],
          },
        ],
      },
      {
        width: 'auto',
        margin: [0, t.marcaSvg ? 8 : 2, 0, 0],
        text: rotuloDireita.toUpperCase(),
        font: t.display,
        fontSize: 8,
        characterSpacing: 1.8,
        color: PDF_COR.subtle,
      },
    ],
  };
}

/** Filete amarelo da marca, largura da área útil de uma A4 com margens de 40. */
export function fileteMarca(margemTopo = 10): any {
  return {
    canvas: [{ type: 'rect', x: 0, y: 0, w: 515, h: 2, color: PDF_COR.marca }],
    margin: [0, margemTopo, 0, 0],
  };
}
