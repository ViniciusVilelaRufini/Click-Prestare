import { BadRequestException } from '@nestjs/common';

/**
 * Validação mínima dos corpos das rotas do Guarita (os DTOs são interfaces,
 * sem class-validator). As rotas do agente são públicas por token: nada do
 * corpo é confiável.
 */

export function inteiro(v: unknown, campo: string, min: number, max: number): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) {
    throw new BadRequestException(`Campo "${campo}" inválido.`);
  }
  return n;
}

export function inteiroOuNulo(v: unknown, campo: string, min: number, max: number): number | null {
  if (v === null || v === undefined) return null;
  return inteiro(v, campo, min, max);
}

export function booleano(v: unknown, campo: string): boolean {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  throw new BadRequestException(`Campo "${campo}" inválido.`);
}

export function booleanoOpcional(v: unknown): boolean | undefined {
  if (v === undefined || v === null) return undefined;
  return v === true || v === 1;
}

/** Texto livre vindo do agente: corta e remove caracteres de controle. Nunca lança. */
export function textoCurto(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const limpo = v.replace(/[\x00-\x1F\x7F]/g, ' ').trim();
  return limpo ? limpo.slice(0, max) : null;
}

/** Hex com exatamente `bytes` bytes (sem espaços), em maiúsculas. */
export function hexDeTamanho(v: unknown, bytes: number, campo: string): string {
  if (typeof v !== 'string') throw new BadRequestException(`Campo "${campo}" inválido.`);
  const h = v.trim();
  if (h.length !== bytes * 2 || !/^[0-9a-fA-F]+$/.test(h)) {
    throw new BadRequestException(`Campo "${campo}" inválido.`);
  }
  return h.toUpperCase();
}

/** Data ISO opcional; inválida → null (não derruba o lote). */
export function dataOuNula(v: unknown): Date | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
