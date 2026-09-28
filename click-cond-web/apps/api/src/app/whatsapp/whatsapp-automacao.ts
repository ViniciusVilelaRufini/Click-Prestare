/** Regras puras das respostas automáticas do WhatsApp (sem banco, sem rede). */

export interface ConfigAutomacoes {
  boasVindas: { ativo: boolean; texto: string };
  foraHorario: { ativo: boolean; texto: string; dias: number[]; inicio: string; fim: string };
}

export type TipoAutomatica = 'auto_boas_vindas' | 'auto_fora_horario';

export const AUTOMACOES_PADRAO: ConfigAutomacoes = {
  boasVindas: {
    ativo: false,
    texto:
      'Olá! Aqui é a Prestare Gestão 👋 Recebemos sua mensagem e já vamos te atender. Para agilizar, qual o nome do condomínio e quantas unidades ele tem?',
  },
  foraHorario: {
    ativo: false,
    texto:
      'Recebemos sua mensagem! Nosso atendimento é de segunda a sexta, das 8h às 18h. Retornamos assim que possível.',
    dias: [1, 2, 3, 4, 5], // 0 = domingo … 6 = sábado
    inicio: '08:00',
    fim: '18:00',
  },
};

const BRT_MS = 3 * 3600e3; // America/Sao_Paulo, sem horário de verão
const REPETIR_FORA_MS = 12 * 3600e3;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

const minutos = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export function dentroDoHorario(h: ConfigAutomacoes['foraHorario'], agora: Date): boolean {
  const local = new Date(agora.getTime() - BRT_MS);
  if (!h.dias.includes(local.getUTCDay())) return false;
  const m = local.getUTCHours() * 60 + local.getUTCMinutes();
  return m >= minutos(h.inicio) && m < minutos(h.fim);
}

/**
 * Qual resposta automática mandar (no máximo uma por mensagem recebida).
 * Fora do horário tem prioridade sobre boas-vindas, para o cliente não
 * receber duas mensagens seguidas; e só se repete a cada 12h.
 */
export function decidirAutomacao(p: {
  cfg: ConfigAutomacoes;
  conversaNova: boolean;
  ultimaForaHorarioEm: Date | null;
  agora: Date;
}): { tipo: TipoAutomatica; texto: string } | null {
  const { cfg, agora } = p;
  if (cfg.foraHorario.ativo && !dentroDoHorario(cfg.foraHorario, agora)) {
    const recente = p.ultimaForaHorarioEm && agora.getTime() - p.ultimaForaHorarioEm.getTime() < REPETIR_FORA_MS;
    if (!recente) return { tipo: 'auto_fora_horario', texto: cfg.foraHorario.texto };
    return null;
  }
  if (cfg.boasVindas.ativo && p.conversaNova) return { tipo: 'auto_boas_vindas', texto: cfg.boasVindas.texto };
  return null;
}

function texto(v: unknown, padrao: string): string {
  const t = typeof v === 'string' ? v.trim().slice(0, 1000) : '';
  return t || padrao;
}

/** Valida o que vem do CRM/banco e completa com o padrão. */
export function normalizarConfig(v: unknown): ConfigAutomacoes {
  const b: any = (v && typeof v === 'object' ? (v as any).boasVindas : null) ?? {};
  const f: any = (v && typeof v === 'object' ? (v as any).foraHorario : null) ?? {};
  const P = AUTOMACOES_PADRAO;
  const dias = Array.isArray(f.dias)
    ? [...new Set(f.dias.filter((d: unknown) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6))].sort() as number[]
    : P.foraHorario.dias;
  return {
    boasVindas: { ativo: b.ativo === true, texto: texto(b.texto, P.boasVindas.texto) },
    foraHorario: {
      ativo: f.ativo === true,
      texto: texto(f.texto, P.foraHorario.texto),
      dias,
      inicio: HORA.test(f.inicio) ? f.inicio : P.foraHorario.inicio,
      fim: HORA.test(f.fim) ? f.fim : P.foraHorario.fim,
    },
  };
}
