import { Logger } from '@nestjs/common';

/**
 * Limites de foto dos terminais faciais Intelbras/Dahua: acima disso o
 * AccessFace.cgi responde "Bad Request" e o rosto nunca é cadastrado.
 * Margem de ~5 KB abaixo dos 100 KB do fabricante.
 */
export const LIMITE_FOTO_TERMINAL = { largura: 600, altura: 1200, bytes: 95 * 1024 };

const logger = new Logger('FotoTerminal');

type Sharp = typeof import('sharp');
let sharpCarregado: Sharp | null | undefined;

async function carregarSharp(): Promise<Sharp | null> {
  if (sharpCarregado !== undefined) return sharpCarregado;
  try {
    const mod: any = await import('sharp');
    sharpCarregado = (mod.default ?? mod) as Sharp;
  } catch (err) {
    // Sem a lib (pacote de deploy desatualizado): segue com a foto original,
    // que é exatamente o comportamento anterior — não piora nada.
    logger.warn(`sharp indisponível; fotos vão sem redimensionar: ${(err as Error)?.message ?? err}`);
    sharpCarregado = null;
  }
  return sharpCarregado;
}

/**
 * Deixa a foto (base64, sem prefixo data:) dentro do que o terminal aceita:
 * JPEG, até 600x1200 mantendo a proporção, e abaixo do limite de bytes.
 * Foto que já cabe volta intacta; conteúdo que não é imagem volta como veio.
 */
export async function normalizarFotoParaTerminal(base64: string): Promise<string> {
  const sharp = await carregarSharp();
  if (!sharp || !base64) return base64;

  const original = Buffer.from(base64, 'base64');
  let meta;
  try {
    meta = await sharp(original).metadata();
  } catch {
    return base64;
  }

  const cabe =
    meta.format === 'jpeg' &&
    (meta.width ?? 0) <= LIMITE_FOTO_TERMINAL.largura &&
    (meta.height ?? 0) <= LIMITE_FOTO_TERMINAL.altura &&
    original.length <= LIMITE_FOTO_TERMINAL.bytes;
  if (cabe) return base64;

  try {
    const redimensionada = sharp(original)
      .rotate() // respeita a orientação EXIF da câmera do celular
      .resize({
        width: LIMITE_FOTO_TERMINAL.largura,
        height: LIMITE_FOTO_TERMINAL.altura,
        fit: 'inside',
        withoutEnlargement: true,
      });
    let saida: Buffer = original;
    for (const quality of [85, 75, 65, 55, 45, 35]) {
      saida = await redimensionada.clone().jpeg({ quality, mozjpeg: true }).toBuffer();
      if (saida.length <= LIMITE_FOTO_TERMINAL.bytes) break;
    }
    return saida.toString('base64');
  } catch (err) {
    logger.warn(`Falha ao redimensionar foto para o terminal: ${(err as Error)?.message ?? err}`);
    return base64;
  }
}
