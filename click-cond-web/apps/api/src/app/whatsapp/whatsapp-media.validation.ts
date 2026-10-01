import { BadRequestException } from '@nestjs/common';

export type TipoMidiaSaida = 'image' | 'video' | 'document';

const MIMES: Record<TipoMidiaSaida, Set<string>> = {
  image: new Set(['image/jpeg', 'image/png', 'image/webp']),
  video: new Set(['video/3gpp', 'video/mp4']),
  document: new Set([
    'application/pdf', 'text/plain', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ]),
};

const PADROES: Record<TipoMidiaSaida, number> = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  document: 100 * 1024 * 1024,
};

function limite(tipo: TipoMidiaSaida): number {
  const valor = Number(process.env[`WA_MEDIA_${tipo.toUpperCase()}_MAX_BYTES`] ?? PADROES[tipo]);
  return Number.isSafeInteger(valor) && valor > 0 ? valor : PADROES[tipo];
}

export const LIMITE_MULTIPART = Math.max(...(Object.keys(PADROES) as TipoMidiaSaida[]).map(limite));

export function validarMidiaSaida(entrada: { tipo: TipoMidiaSaida; buffer: Buffer; mimetype: string; originalname: string }): void {
  const { tipo, buffer, mimetype, originalname } = entrada;
  if (!MIMES[tipo]?.has(mimetype) || !Buffer.isBuffer(buffer) || !buffer.length || !originalname?.trim()) {
    throw new BadRequestException('Mídia inválida.');
  }
  if (buffer.length > limite(tipo)) throw new BadRequestException('Mídia excede o limite permitido.');
  if (!assinaturaValida(tipo, mimetype, buffer)) throw new BadRequestException('Conteúdo da mídia não corresponde ao tipo informado.');
}

function assinaturaValida(tipo: TipoMidiaSaida, mime: string, buffer: Buffer): boolean {
  if (tipo === 'image') {
    if (mime === 'image/jpeg') return buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    if (mime === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    return buffer.subarray(0, 4).equals(Buffer.from('RIFF')) && buffer.subarray(8, 12).equals(Buffer.from('WEBP'));
  }
  if (tipo === 'video') return buffer.subarray(4, 8).equals(Buffer.from('ftyp'));
  if (mime === 'application/pdf') return buffer.subarray(0, 5).equals(Buffer.from('%PDF-'));
  if (mime === 'text/plain') return !buffer.subarray(0, 4096).includes(0);
  if (mime === 'application/msword' || mime === 'application/vnd.ms-excel' || mime === 'application/vnd.ms-powerpoint') {
    return buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  }
  return buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
}
