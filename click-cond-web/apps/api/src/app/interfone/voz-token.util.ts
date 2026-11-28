import { UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

/**
 * Autenticação das rotas internas do interfone (serviço de voz → API):
 * cabeçalho `x-voz-token` igual a VOZ_INTERNAL_TOKEN, comparado em tempo
 * constante. Falha fechado: sem a env configurada, ninguém entra.
 */
export function assertVozToken(header: string | string[] | undefined): void {
  const esperado = process.env['VOZ_INTERNAL_TOKEN'];
  const token = Array.isArray(header) ? header[0] : header;
  if (!esperado || !token) throw new UnauthorizedException('Token de voz inválido.');
  const a = Buffer.from(token);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException('Token de voz inválido.');
}
