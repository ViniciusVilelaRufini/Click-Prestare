import { Injectable, Logger } from '@nestjs/common';
import { MarketingSegredosService } from '../marketing/marketing-segredos.service';

const PHONE_ID = process.env.WA_PHONE_ID || '1356887267509002';
const BASE = `https://graph.facebook.com/v25.0/${PHONE_ID}/messages`;

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
}
