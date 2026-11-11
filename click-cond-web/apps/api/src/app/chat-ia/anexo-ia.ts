import { BadRequestException } from '@nestjs/common';

export const MAX_ANEXO_BYTES = 5 * 1024 * 1024;
export const MSG_ANEXO_RECUSADO = 'Arquivo não aceito: envie PDF ou imagem de até 5 MB.';

/** Tipo real pelos bytes iniciais; null se não for PDF/JPEG/PNG/WEBP. */
export function detectarMime(b: Buffer): string | null {
  if (b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (
    b.length >= 12 &&
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * Valida o anexo do chat no servidor (o mime e o nome vindos do cliente não
 * valem): tamanho decodificado e tipo pelos bytes. Devolve o mime detectado.
 */
export function validarAnexo(base64: string): string {
  const estimado = Math.floor((base64.length * 3) / 4);
  if (estimado > MAX_ANEXO_BYTES + 3) throw new BadRequestException(MSG_ANEXO_RECUSADO);
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length > MAX_ANEXO_BYTES) throw new BadRequestException(MSG_ANEXO_RECUSADO);
  const mime = detectarMime(bytes);
  if (!mime) throw new BadRequestException(MSG_ANEXO_RECUSADO);
  return mime;
}
