import { Logger } from '@nestjs/common';

/**
 * Foto do visitante no card ao vivo.
 *
 * A Live Activity não acessa a rede: a imagem tem de chegar DENTRO do push,
 * que o APNs limita a 4 KB (o push só de dados do FCM também). Por isso uma
 * miniatura JPEG quadrada de até 96 px em base64, com teto de tamanho — o
 * resto do payload ocupa ~1 KB.
 */
export const MAX_FOTO_BASE64 = 2600;

const TENTATIVAS: Array<[lado: number, qualidade: number]> = [
  [96, 60],
  [80, 50],
  [64, 45],
  [56, 35],
];

const logger = new Logger('CardMiniatura');
type Sharp = typeof import('sharp');
let sharpCarregado: Sharp | null | undefined;

async function carregarSharp(): Promise<Sharp | null> {
  if (sharpCarregado !== undefined) return sharpCarregado;
  try {
    const mod: any = await import('sharp');
    sharpCarregado = (mod.default ?? mod) as Sharp;
  } catch (err) {
    logger.warn(`sharp indisponível; card sem foto: ${(err as Error)?.message ?? err}`);
    sharpCarregado = null;
  }
  return sharpCarregado;
}

/** Miniatura em base64 (sem prefixo data:), ou null se não der (sem foto = iniciais). */
export async function miniaturaBase64(bytes: Buffer): Promise<string | null> {
  const sharp = await carregarSharp();
  if (!sharp || !bytes?.length) return null;
  try {
    for (const [lado, qualidade] of TENTATIVAS) {
      const jpeg = await sharp(bytes, { failOn: 'none' })
        .rotate() // orientação EXIF da câmera
        .resize(lado, lado, { fit: 'cover', position: 'attention' })
        .jpeg({ quality: qualidade, mozjpeg: true })
        .toBuffer();
      const b64 = jpeg.toString('base64');
      if (b64.length <= MAX_FOTO_BASE64) return b64;
    }
  } catch {
    // Arquivo que não é imagem: o card sai com as iniciais.
  }
  return null;
}
