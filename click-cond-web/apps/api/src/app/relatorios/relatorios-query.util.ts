import { BadRequestException } from '@nestjs/common';

/**
 * Normalização da query string das rotas de auditoria/eventos. O Express
 * entrega `string`, mas também array (`?modulo=a&modulo=b`) e objeto
 * (`?modulo[x]=y`) — e nada disso pode chegar cru no Prisma.
 */

/** Texto único: array vira o primeiro valor de texto; o resto é ignorado. */
export function textoUnico(valor: unknown): string | undefined {
  const v = Array.isArray(valor) ? valor[0] : valor;
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s ? s : undefined;
}

/** Inteiro >= 1; qualquer outra coisa (NaN, fração, negativo, array) cai no padrão. */
export function inteiroPositivoOuPadrao(valor: unknown, padrao: number): number {
  if (typeof valor !== 'string' || !/^\d{1,9}$/.test(valor.trim())) return padrao;
  const n = Number(valor.trim());
  return n >= 1 ? n : padrao;
}

/** Data `AAAA-MM-DD` de calendário; ausente/vazia vira undefined, inválida responde 400. */
export function dataIsoOuErro(valor: unknown, nome: string): string | undefined {
  if (valor === undefined || valor === null || valor === '') return undefined;
  const v = Array.isArray(valor) ? valor[0] : valor;
  const s = typeof v === 'string' ? v.trim() : null;
  if (s === '') return undefined;
  let valida = false;
  if (s !== null && /^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T00:00:00.000Z`);
    // Rejeita 2026-13-45 (Invalid Date) e 2026-02-30 (que o Date "corrigiria" para março).
    valida = !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }
  if (!valida) {
    throw new BadRequestException(`${nome} inválida: use o formato AAAA-MM-DD.`);
  }
  return s as string;
}
