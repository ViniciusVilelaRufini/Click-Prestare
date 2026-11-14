import { BadRequestException } from '@nestjs/common';

/**
 * Domínio das lápides de login/e-mail que a revogação de acesso à portaria grava na conta que era só da equipe
 * de um condomínio (PrestadoresService). `.invalid` é reservado (RFC 2606): nunca é e-mail de ninguém.
 *
 * Nenhum cadastro aceita e-mail ou login neste domínio: quem ocupasse de antemão a lápide de uma conta fazia a
 * revogação dela bater no @unique (o signup público não valida formato).
 */
export const DOMINIO_CONTA_REVOGADA = 'conta-revogada.invalid';

export function ehEmailReservado(valor: unknown): boolean {
  if (typeof valor !== 'string') return false;
  const v = valor.trim().toLowerCase();
  return v.endsWith(`@${DOMINIO_CONTA_REVOGADA}`) || v.endsWith(`.${DOMINIO_CONTA_REVOGADA}`);
}

/** 400 neutro, a mesma resposta de e-mail mal formado: não conta que o domínio é usado internamente. */
export function assertEmailNaoReservado(...valores: unknown[]): void {
  if (valores.some(ehEmailReservado)) throw new BadRequestException('E-mail inválido.');
}
