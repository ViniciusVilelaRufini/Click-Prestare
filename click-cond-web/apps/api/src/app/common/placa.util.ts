import { BadRequestException } from '@nestjs/common';

/**
 * Aceita o padrão antigo (AAA9999) e o Mercosul (AAA9A99), com ou sem hífen
 * e espaços. Devolve a placa normalizada (só letras maiúsculas e dígitos).
 */
export function validarPlaca(placa: string | null | undefined): string {
  const p = (placa ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(p)) {
    throw new BadRequestException('Placa inválida. Use o formato ABC1234 ou ABC1D23.');
  }
  return p;
}
