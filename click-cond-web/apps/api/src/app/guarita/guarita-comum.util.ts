import { NotFoundException } from '@nestjs/common';
import { TIPO_DEVICE_GUARITA } from './guarita.constantes';

/** O Guarita de um condomínio, como as rotas do console o enxergam (sem a palavra de autorização). */
export interface GuaritaDoCondominio {
  id: number;
  id_condominio: number;
  nome: string;
  ativo: number;
}

/**
 * Guarita `deviceId` do condomínio `idCondominio`, ou 404 (de outro
 * condomínio, inexistente ou de outro tipo dão a mesma resposta).
 */
export async function buscarGuaritaDoCondominio(
  prisma: any,
  idCondominio: number,
  deviceId: number,
): Promise<GuaritaDoCondominio> {
  const d = await prisma.facial_Devices.findFirst({
    where: { id: Number(deviceId), id_condominio: Number(idCondominio), tipo: TIPO_DEVICE_GUARITA },
    select: { id: true, id_condominio: true, nome: true, ativo: true },
  });
  if (!d) throw new NotFoundException('Guarita não encontrado.');
  return d;
}

/** Nome de quem fez a ação, para `criado_por`/auditoria. */
export function autorDoUsuario(user: any): string {
  const nome = user?.nome ?? user?.user?.nome ?? user?.name ?? null;
  return String(nome ?? 'Portaria').slice(0, 120);
}

/** Dígitos de `Apartamentos.apto` como número ("Apto 202" → 202; sem dígitos → null). */
export function numeroDaUnidade(apto: string | null | undefined): number | null {
  const d = String(apto ?? '').replace(/\D/g, '');
  if (!d) return null;
  const n = Number(d);
  return Number.isSafeInteger(n) ? n : null;
}

/** Bloco comparável: maiúsculas, sem espaços e sem o prefixo "Bloco". */
export function blocoComparavel(bloco: string | null | undefined): string {
  const s = String(bloco ?? '')
    .trim()
    .toUpperCase()
    .replace(/^BLOCO\s*/, '')
    .replace(/\s+/g, '');
  return /^\d+$/.test(s) ? String(Number(s)) : s;
}
