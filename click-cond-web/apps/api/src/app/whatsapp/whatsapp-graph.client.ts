import { Injectable, Logger } from '@nestjs/common';
import { Readable } from 'node:stream';
import { MarketingSegredosService } from '../marketing/marketing-segredos.service';

const PHONE_ID = process.env.WA_PHONE_ID || '1356887267509002';
const BASE = `https://graph.facebook.com/v25.0/${PHONE_ID}/messages`;
const MEDIA_BASE = `https://graph.facebook.com/v25.0/${PHONE_ID}/media`;

export interface ArquivoWhatsapp {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

export interface EnvioMidiaWhatsapp {
  para: string;
  tipo: 'image' | 'video' | 'document';
  arquivo: ArquivoWhatsapp;
  legenda?: string;
}

@Injectable()
export class WhatsappGraphClient {
  private readonly logger = new Logger(WhatsappGraphClient.name);

  constructor(private readonly segredos: MarketingSegredosService) {}

  private async post(corpo: object): Promise<any> {
    const token = await this.segredos.obter('WA_ACCESS_TOKEN');
    if (!token) throw new Error('WA_ACCESS_TOKEN não configurado');
    const r = await fetch(BASE, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...corpo }),
    });
    const json: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json?.error?.message ?? `Graph API ${r.status}`);
    return json;
  }

  async enviarTexto(para: string, texto: string): Promise<string> {
    const json = await this.post({ to: para, type: 'text', text: { body: texto, preview_url: false } });
    const id = json?.messages?.[0]?.id;
    if (!id) throw new Error('Graph API não devolveu o id da mensagem');
    return String(id);
  }

  /** Modelo aprovado no Meta — única forma de iniciar conversa fora da janela de 24h. */
  async enviarModelo(para: string, nome: string, idioma = 'pt_BR'): Promise<string> {
    const json = await this.post({ to: para, type: 'template', template: { name: nome, language: { code: idioma } } });
    const id = json?.messages?.[0]?.id;
    if (!id) throw new Error('Graph API não devolveu o id da mensagem');
    return String(id);
  }

  async marcarLida(wamid: string): Promise<void> {
    try {
      await this.post({ status: 'read', message_id: wamid });
    } catch (e: any) {
      this.logger.warn(`Falha ao marcar ${wamid} como lida: ${e?.message}`);
    }
  }

  /** Faz upload privado no Graph e só então referencia o media id na mensagem. */
  async enviarMidia({ para, tipo, arquivo, legenda }: EnvioMidiaWhatsapp): Promise<string> {
    if (!['image', 'video', 'document'].includes(tipo)) throw new Error('Tipo de mídia não permitido');
    if (!arquivo?.buffer?.length || !arquivo.mimetype || !arquivo.originalname) throw new Error('Arquivo de mídia inválido');
    const token = await this.segredos.obter('WA_ACCESS_TOKEN');
    if (!token) throw new Error('WA_ACCESS_TOKEN não configurado');

    const form = new FormData();
    const conteudoArquivo = new Uint8Array(arquivo.buffer.length);
    conteudoArquivo.set(arquivo.buffer);
    form.append('messaging_product', 'whatsapp');
    form.append('file', new Blob([conteudoArquivo], { type: arquivo.mimetype }), this.nomeArquivoSeguro(arquivo.originalname));
    const upload = await fetch(MEDIA_BASE, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
    const uploadJson: any = await upload.json().catch(() => ({}));
    if (!upload.ok) throw new Error(uploadJson?.error?.message ?? `Graph API ${upload.status}`);
    if (!uploadJson?.id) throw new Error('Graph API não devolveu o id da mídia');

    const conteudo = { id: String(uploadJson.id), ...(legenda?.trim() ? { caption: legenda.trim() } : {}) };
    const json = await this.post({ to: para, type: tipo, [tipo]: conteudo });
    const wamid = json?.messages?.[0]?.id;
    if (!wamid) throw new Error('Graph API não devolveu o id da mensagem');
    return String(wamid);
  }

  async obterMidia(mediaId: string): Promise<{ mime: string; nome?: string; tamanho: number }> {
    const token = await this.segredos.obter('WA_ACCESS_TOKEN');
    if (!token) throw new Error('WA_ACCESS_TOKEN não configurado');
    const r = await fetch(`https://graph.facebook.com/v25.0/${encodeURIComponent(mediaId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json?.error?.message ?? `Graph API ${r.status}`);
    const tamanho = Number(json?.file_size);
    if (!json?.mime_type || !Number.isSafeInteger(tamanho)) throw new Error('Graph API não devolveu metadados da mídia');
    return { mime: String(json.mime_type), ...(json.filename ? { nome: String(json.filename) } : {}), tamanho };
  }

  async baixarMidia(mediaId: string): Promise<Readable> {
    const token = await this.segredos.obter('WA_ACCESS_TOKEN');
    if (!token) throw new Error('WA_ACCESS_TOKEN não configurado');
    const metadados = await fetch(`https://graph.facebook.com/v25.0/${encodeURIComponent(mediaId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json: any = await metadados.json().catch(() => ({}));
    if (!metadados.ok || !json?.url) throw new Error(json?.error?.message ?? `Graph API ${metadados.status}`);
    const arquivo = await fetch(String(json.url), { headers: { Authorization: `Bearer ${token}` } });
    if (!arquivo.ok || !arquivo.body) throw new Error(`Graph API ${arquivo.status}`);
    return Readable.fromWeb(arquivo.body as any);
  }

  private nomeArquivoSeguro(nome: string): string {
    return nome.replace(/[\r\n\\/:*?"<>|\x00-\x1F]/g, '_').slice(0, 255) || 'arquivo';
  }
}
