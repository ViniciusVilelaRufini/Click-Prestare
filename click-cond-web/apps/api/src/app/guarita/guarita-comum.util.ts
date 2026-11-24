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

/** Resultado da conversão estrita do texto de unidade/bloco para o Guarita. */
export type UnidadeGuarita = { ok: true; unidade: number; bloco: number } | { ok: false; erro: string };

/**
 * Texto da unidade do Prestare → (unidade, byte do bloco) do Guarita, ESTRITO
 * (a única função que decide isso, nos dois sentidos):
 *  - `apto`: tirando os espaços, só dígitos (zeros à esquerda valem), até 9999;
 *  - `bloco`: vazio, uma letra A–Z, um número 1–230, ou "Bloco X"/"Torre X"/
 *    "Bl X" com X numa dessas formas; vazio só vira A quando TODOS os
 *    apartamentos do condomínio têm bloco vazio (`condominioSemBlocos`).
 * Qualquer outra coisa ("101A", "Apto 308", "Torre 2 Apto 101") não grava.
 */
export function unidadeGuaritaDoTexto(
  bloco: string | null | undefined,
  apto: string | null | undefined,
  condominioSemBlocos: boolean,
): UnidadeGuarita {
  const blocoTxt = String(bloco ?? '').trim();
  const aptoTxt = String(apto ?? '').trim();
  const falha = (): UnidadeGuarita => ({
    ok: false,
    erro: `A unidade '${[blocoTxt, aptoTxt].filter(Boolean).join(' / ')}' não tem número compatível com o Guarita.`,
  });
  const digitos = aptoTxt.replace(/\s+/g, '');
  if (!/^\d+$/.test(digitos)) return falha();
  const unidade = Number(digitos);
  if (!Number.isInteger(unidade) || unidade > 9999) return falha();

  if (!blocoTxt) return condominioSemBlocos ? { ok: true, unidade, bloco: 0x00 } : falha();
  const x = blocoTxt.replace(/^(bloco|torre|bl\.?)(\s+|(?=\d))/i, '').trim();
  if (/^[A-Za-z]$/.test(x)) return { ok: true, unidade, bloco: x.toUpperCase().charCodeAt(0) - 0x41 };
  if (/^\d{1,3}$/.test(x)) {
    const n = Number(x);
    if (n >= 1 && n <= 230) return { ok: true, unidade, bloco: 0x19 + n };
  }
  return falha();
}

/**
 * G7: o P2002 veio da chave única un_tag_guarita (id_device, guarita_tipo,
 * guarita_serial) — o mesmo controle já está em outra tag deste Guarita (a
 * outra instância criou primeiro). `meta.target` é o nome do índice (MySQL) ou
 * a lista de campos.
 */
export function violouChaveDoGuarita(err: any): boolean {
  if (err?.code !== 'P2002') return false;
  const alvo = [err?.meta?.target].flat().filter(Boolean).join(',');
  return /un_tag_guarita|guarita_serial/.test(alvo);
}
