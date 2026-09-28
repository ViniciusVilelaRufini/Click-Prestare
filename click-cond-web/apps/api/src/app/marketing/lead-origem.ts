import { BadRequestException } from '@nestjs/common';

export type LeadOrigem = 'google' | 'openai' | 'instagram' | 'organico';

export interface LeadEntrada {
  nome: string;
  condominio: string;
  unidades: string;
  whatsapp: string;
  gclid?: string;
  oppref?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  pagina?: string;
}

const temValor = (v?: string | null) => !!v && v.trim().length > 0;

export function derivarOrigem(p: { gclid?: string | null; oppref?: string | null; utm_source?: string | null }): LeadOrigem {
  if (temValor(p.gclid)) return 'google';
  if (temValor(p.oppref)) return 'openai';
  if (temValor(p.utm_source) && p.utm_source!.trim().toLowerCase() === 'instagram') return 'instagram';
  return 'organico';
}

function texto(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function opcional(v: unknown, max: number): string | undefined {
  const t = texto(v, max);
  return t ? t : undefined;
}

export function validarLead(body: unknown): LeadEntrada {
  if (!body || typeof body !== 'object') throw new BadRequestException('Dados do pedido inválidos.');
  const b = body as Record<string, unknown>;
  const nome = texto(b.nome, 120);
  const condominio = texto(b.condominio, 160);
  const unidades = texto(b.unidades, 60);
  const whatsapp = texto(b.whatsapp, 40).replace(/\D/g, '');
  if (!nome || !condominio || !unidades) throw new BadRequestException('Preencha nome, condomínio e unidades.');
  if (whatsapp.length < 10 || whatsapp.length > 13) throw new BadRequestException('WhatsApp inválido.');
  return {
    nome,
    condominio,
    unidades,
    whatsapp,
    gclid: opcional(b.gclid, 255),
    oppref: opcional(b.oppref, 255),
    utm_source: opcional(b.utm_source, 120),
    utm_medium: opcional(b.utm_medium, 120),
    utm_campaign: opcional(b.utm_campaign, 120),
    pagina: opcional(b.pagina, 255),
  };
}

const CANAIS: Record<string, string> = { whatsapp: 'WhatsApp', instagram: 'Instagram' };

/**
 * Clique direto no botão de WhatsApp/Instagram da landing: a pessoa não
 * preencheu nada, mas o contato chega na conversa — registra o lead com a
 * origem do anúncio para ele aparecer no CRM e ser completado lá.
 */
export function leadDeClique(body: unknown): LeadEntrada | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const canal = typeof b.clique === 'string' ? CANAIS[b.clique] : undefined;
  if (!canal) return null;
  return {
    nome: `Clique no ${canal} (sem dados)`,
    condominio: '—',
    unidades: '—',
    whatsapp: '',
    gclid: opcional(b.gclid, 255),
    oppref: opcional(b.oppref, 255),
    utm_source: opcional(b.utm_source, 120),
    utm_medium: opcional(b.utm_medium, 120),
    utm_campaign: opcional(b.utm_campaign, 120),
    pagina: opcional(b.pagina, 255),
  };
}
