import { Logger } from '@nestjs/common';

/**
 * Conferência da selfie do entregador: o prefixo `data:image/...` é só o que
 * a página DIZ. Aqui os bytes são decodificados de verdade (sharp): só JPEG,
 * PNG ou WebP inteiros, do mesmo tipo declarado, passam.
 */

const logger = new Logger('SelfieEntregador');
type Sharp = typeof import('sharp');
let sharpCarregado: Sharp | null | undefined;

async function carregarSharp(): Promise<Sharp | null> {
  if (sharpCarregado !== undefined) return sharpCarregado;
  try {
    const mod: any = await import('sharp');
    sharpCarregado = (mod.default ?? mod) as Sharp;
  } catch (err) {
    logger.error(`sharp indisponível; selfies do portão recusadas: ${(err as Error)?.message ?? err}`);
    sharpCarregado = null;
  }
  return sharpCarregado;
}

/** Teto de pixels decodificados (a página manda ~800 px; 24 MP cobre qualquer câmera). */
const MAX_PIXELS = 24_000_000;
const DATA_URL = /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/is;

/** Lado maior da selfie gravada (a página já manda ~800 px). */
const LADO_MAXIMO = 1280;

/**
 * 'invalida': não é imagem, está cortada, é de outro tipo ou grande demais.
 * 'sem_conferencia': o sharp não carregou (falha fechada: quem chama recusa).
 * Válida: a data URL da foto RECODIFICADA (JPEG, orientação aplicada, sem
 * EXIF/GPS nem outro metadado) — é ela que vai para o bucket, nunca os
 * bytes que a página mandou.
 */
export type ResultadoSelfie = { ok: true; dataUrl: string } | 'invalida' | 'sem_conferencia';

export async function conferirSelfie(dataUrl: string): Promise<ResultadoSelfie> {
  const m = DATA_URL.exec(dataUrl);
  if (!m) return 'invalida';
  const declarado = m[1].toLowerCase() === 'jpg' ? 'jpeg' : m[1].toLowerCase();
  const bytes = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
  if (!bytes.length) return 'invalida';
  const sharp = await carregarSharp();
  if (!sharp) return 'sem_conferencia';
  try {
    const meta = await sharp(bytes, { limitInputPixels: MAX_PIXELS }).metadata();
    if (meta.format !== declarado) return 'invalida';
    // Decodifica tudo (failOn padrão 'warning': JPEG cortado falha) e
    // recodifica: sem withMetadata, o sharp não copia EXIF, GPS nem ICC.
    const jpeg = await sharp(bytes, { limitInputPixels: MAX_PIXELS })
      .rotate()
      .resize(LADO_MAXIMO, LADO_MAXIMO, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
    return { ok: true, dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}` };
  } catch {
    return 'invalida';
  }
}
