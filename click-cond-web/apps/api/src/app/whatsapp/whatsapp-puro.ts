import { createHmac, timingSafeEqual } from 'crypto';

export interface EntradaWa {
  wamid: string; waId: string; nomePerfil?: string; tipo: string; texto: string; em: Date;
  mediaId?: string; mime?: string; nome?: string;
}
export interface StatusWa { wamid: string; status: 'enviada' | 'entregue' | 'lida' | 'falhou'; erro?: string }

const JANELA_MS = 24 * 60 * 60 * 1000;

export function assinaturaValida(corpo: Buffer | undefined, cabecalho: string | undefined, segredo: string | undefined): boolean {
  if (!corpo || !cabecalho || !segredo) return false;
  const esperado = Buffer.from('sha256=' + createHmac('sha256', segredo).update(corpo).digest('hex'));
  const recebido = Buffer.from(cabecalho);
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
}

const MARCADORES: Record<string, string> = {
  image: '[imagem recebida]', audio: '[áudio recebido]', video: '[vídeo recebido]',
  document: '[documento recebido]', sticker: '[figurinha recebida]', location: '[localização recebida]',
  contacts: '[contato recebido]',
};

function textoDe(m: any): string {
  if (m?.type === 'text') return String(m.text?.body ?? '');
  if (m?.type === 'button') return String(m.button?.text ?? '');
  if (m?.type === 'interactive') return String(m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '[resposta interativa]');
  return MARCADORES[m?.type] ?? `[${m?.type ?? 'mensagem'} recebida]`;
}

const STATUS: Record<string, StatusWa['status']> = { sent: 'enviada', delivered: 'entregue', read: 'lida', failed: 'falhou' };

export function interpretarWebhook(body: unknown): { mensagens: EntradaWa[]; status: StatusWa[] } {
  const mensagens: EntradaWa[] = [];
  const status: StatusWa[] = [];
  const entries = Array.isArray((body as any)?.entry) ? (body as any).entry : [];
  for (const e of entries) {
    for (const c of Array.isArray(e?.changes) ? e.changes : []) {
      const v = c?.value ?? {};
      const nomes = new Map<string, string>();
      for (const ct of Array.isArray(v.contacts) ? v.contacts : []) if (ct?.wa_id) nomes.set(String(ct.wa_id), String(ct.profile?.name ?? ''));
      for (const m of Array.isArray(v.messages) ? v.messages : []) {
        if (!m?.id || !m?.from) continue;
        const waId = String(m.from).replace(/\D/g, '');
        const nome = nomes.get(waId);
        const midia = m?.[m.type];
        const mediaId = typeof midia?.id === 'string' ? midia.id : undefined;
        const mime = typeof midia?.mime_type === 'string' ? midia.mime_type : undefined;
        const nomeArquivo = typeof midia?.filename === 'string' ? midia.filename : undefined;
        mensagens.push({
          wamid: String(m.id), waId, ...(nome ? { nomePerfil: nome } : {}), tipo: String(m.type ?? 'desconhecido'),
          texto: textoDe(m), em: new Date(Number(m.timestamp) * 1000),
          ...(mediaId ? { mediaId } : {}), ...(mime ? { mime } : {}), ...(nomeArquivo ? { nome: nomeArquivo } : {}),
        });
      }
      for (const s of Array.isArray(v.statuses) ? v.statuses : []) {
        const st = STATUS[s?.status];
        if (!s?.id || !st) continue;
        const erro = s.errors?.[0]?.title ?? s.errors?.[0]?.message;
        status.push({ wamid: String(s.id), status: st, ...(st === 'falhou' && erro ? { erro: String(erro).slice(0, 500) } : {}) });
      }
    }
  }
  return { mensagens, status };
}

export function janelaAberta(ultimaDoCliente: Date | null, agora = new Date()): boolean {
  return !!ultimaDoCliente && agora.getTime() - ultimaDoCliente.getTime() < JANELA_MS;
}

const ORDEM: Record<string, number> = { enviada: 1, entregue: 2, lida: 3 };

export function statusAvanca(atual: string, novo: string): boolean {
  if (novo === 'falhou') return atual === 'enviada';
  return (ORDEM[novo] ?? 0) > (ORDEM[atual] ?? 0);
}
