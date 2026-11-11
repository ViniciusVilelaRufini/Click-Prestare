import { HttpException, HttpStatus } from '@nestjs/common';
import type { EstadoCompartilhado } from './estado-compartilhado';

/**
 * Cota diária das chamadas pagas à IA (chat do assistente e leitura de
 * etiqueta). O estado mora no EstadoCompartilhado, então vale entre as
 * instâncias da API. O contador é ler-somar-gravar (não há incremento
 * atômico): numa rajada simultânea pode passar um pouco do teto, o que é
 * aceitável para uma cota de custo.
 */

/** Perguntas por usuário por dia no chat. Sobrescreve: CHAT_IA_COTA_USUARIO_DIA. */
export const COTA_CHAT_USUARIO_DIA = 60;
/** Perguntas por condomínio por dia no chat. Sobrescreve: CHAT_IA_COTA_CONDOMINIO_DIA. */
export const COTA_CHAT_CONDOMINIO_DIA = 300;
/** Leituras de etiqueta por condomínio por dia. Sobrescreve: ETIQUETA_IA_COTA_CONDOMINIO_DIA. */
export const COTA_ETIQUETA_CONDOMINIO_DIA = 200;

export const MSG_COTA_IA = 'Limite diário do assistente atingido. Tente novamente amanhã.';

const DIA_MS = 24 * 60 * 60 * 1000;
const FUSO_MS = 3 * 60 * 60 * 1000; // -03:00
const FOLGA_MS = 60 * 60 * 1000;

export function limiteCota(nomeEnv: string, padrao: number): number {
  const n = Number(process.env[nomeEnv]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : padrao;
}

/** Data (AAAA-MM-DD) e milissegundos até o fim do dia, ambos no fuso -03:00. */
function diaAtual(agora = Date.now()) {
  const local = agora - FUSO_MS;
  const data = new Date(local).toISOString().slice(0, 10);
  const fimDoDia = Math.floor(local / DIA_MS) * DIA_MS + DIA_MS + FUSO_MS;
  return { data, ttlMs: fimDoDia - agora + FOLGA_MS };
}

export interface ItemCota {
  /** Ex.: `chat-ia:cota:usuario:7`. A data entra no fim da chave. */
  prefixo: string;
  limite: number;
}

async function lerCotas(estado: EstadoCompartilhado, itens: ItemCota[]) {
  const { data, ttlMs } = diaAtual();
  const lidos: { chave: string; usado: number }[] = [];
  for (const item of itens) {
    const chave = `${item.prefixo}:${data}`;
    const usado = (await estado.obter<number>(chave))?.valor ?? 0;
    if (usado >= item.limite) throw new HttpException(MSG_COTA_IA, HttpStatus.TOO_MANY_REQUESTS);
    lidos.push({ chave, usado });
  }
  return { lidos, ttlMs };
}

/** Só confere (429 se algum item estourou), sem consumir. Serve de porta de entrada barata. */
export async function verificarCotaDiaria(estado: EstadoCompartilhado, itens: ItemCota[]): Promise<void> {
  await lerCotas(estado, itens);
}

/**
 * Confere todos os itens e só então consome 1 de cada. Se qualquer um já
 * estourou, lança 429 sem consumir nenhum (negar por um não gasta o outro).
 */
export async function consumirCotaDiaria(estado: EstadoCompartilhado, itens: ItemCota[]): Promise<void> {
  const { lidos, ttlMs } = await lerCotas(estado, itens);
  for (const { chave, usado } of lidos) await estado.definir(chave, usado + 1, ttlMs);
}
